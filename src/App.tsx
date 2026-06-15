import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as pdfjs from 'pdfjs-dist';
import {
  Upload,
  Download,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Type,
  PenTool,
  Square,
  Image as ImageIcon,
  Trash2,
  RotateCw,
  Plus,
  Moon,
  Sun,
  ChevronLeft,
  ChevronRight,
  MousePointer,
  X,
  FileText
} from 'lucide-react';

import { getPdfPagesInfo, compilePdf } from './utils/pdf-manager';
import type { PageState, Annotation } from './utils/pdf-manager';
import { PageRenderer } from './components/PageRenderer';
import { TextEditOverlay } from './components/TextEditOverlay';
import { SignaturePad } from './components/SignaturePad';
import { saveDraft, loadDraft, clearDraft } from './utils/draft-store';
import type { SavedDraft } from './utils/draft-store';
import { extractPageTextBlocks } from './utils/pdf-text-extractor';
import type { PdfTextBlock } from './utils/pdf-text-extractor';

export default function App() {
  // Document and file state
  const [pdfFileBytes, setPdfFileBytes] = useState<Uint8Array | null>(null);
  const [pdfFilename, setPdfFilename] = useState<string>('');
  const [pdfDocument, setPdfDocument] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pagesState, setPagesState] = useState<PageState[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  
  // App UI state
  const [activeTool, setActiveTool] = useState<'select' | 'text' | 'draw' | 'shape' | 'signature' | 'image'>('select');
  const [editMode, setEditMode] = useState<'annotate' | 'edit-text'>('annotate');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1.0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isLightTheme, setIsLightTheme] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);

  // Text-edit mode: extracted text blocks per page, keyed by pageId
  const [pdfTextBlocks, setPdfTextBlocks] = useState<Map<string, PdfTextBlock[]>>(new Map());

  // Drawing settings
  const [currentColor, setCurrentColor] = useState<string>('#ff0000');
  const [currentStrokeWidth, setCurrentStrokeWidth] = useState<number>(3);
  const [currentFontSize, setCurrentFontSize] = useState<number>(16);
  const [currentShapeType, setCurrentShapeType] = useState<'rectangle' | 'circle' | 'arrow' | 'line'>('rectangle');
  const [currentIsFilled] = useState<boolean>(false);
  const [currentFillColor] = useState<string>('#ff000022');

  // Modals & draft recovery
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState<boolean>(false);
  const [draftToRecover, setDraftToRecover] = useState<SavedDraft | null>(null);

  // Undo/Redo stacks
  const [history, setHistory] = useState<Array<{ pages: PageState[]; annotations: Annotation[] }>>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // Refs for drawing and drag operations
  const workspaceRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const isDrawingRef = useRef<boolean>(false);
  const drawingPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const tempDrawAnnotationRef = useRef<Annotation | null>(null);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const selectedAnnOriginalBoundsRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const isDraggingAnnotationRef = useRef<boolean>(false);
  const isResizingAnnotationRef = useRef<string | null>(null); // 'nw' | 'ne' | 'se' | 'sw' | null

  // Draft Autosave timer (debounce)
  const saveTimeoutRef = useRef<any>(null);

  // Add a blank page size (standard letter size in points: 612 x 792)
  const addBlankPage = () => {
    const newPage: PageState = {
      id: `page-${crypto.randomUUID()}`,
      originalPageIndex: -1,
      rotationOffset: 0,
      originalRotation: 0,
      width: 612,
      height: 792,
    };
    const newPages = [...pagesState, newPage];
    updatePagesAndAnnotations(newPages, annotations);
  };

  // Push to history stack
  const pushToHistory = (newPages: PageState[], newAnns: Annotation[]) => {
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push({
      pages: JSON.parse(JSON.stringify(newPages)),
      annotations: JSON.parse(JSON.stringify(newAnns)),
    });
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  };

  // Update states and register changes
  const updatePagesAndAnnotations = (newPages: PageState[], newAnns: Annotation[]) => {
    setPagesState(newPages);
    setAnnotations(newAnns);
    setHasUnsavedChanges(true);
    pushToHistory(newPages, newAnns);
  };

  // Check for auto-saved drafts on mount
  useEffect(() => {
    async function checkDraft() {
      const draft = await loadDraft();
      if (draft && draft.pdfBytes && draft.pdfBytes.length > 0) {
        // Validate that the stored bytes are actually a parseable PDF before
        // offering recovery — corrupt/truncated drafts would otherwise show
        // a misleading error alert when the user clicks "Restore Draft".
        try {
          const task = pdfjs.getDocument({ data: draft.pdfBytes.slice(0) });
          await task.promise;
          setDraftToRecover(draft);
        } catch {
          console.warn('Stored draft has invalid PDF bytes — discarding.');
          await clearDraft();
        }
      }
    }
    checkDraft();
  }, []);

  // Autosave tracker
  useEffect(() => {
    if (pdfFileBytes && hasUnsavedChanges) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        setStatusMessage('Autosaving draft...');
        await saveDraft(pdfFileBytes, pagesState, annotations);
        setStatusMessage('Draft saved locally.');
        setTimeout(() => setStatusMessage(''), 2000);
      }, 1500);
    }
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [pagesState, annotations, pdfFileBytes, hasUnsavedChanges]);

  // Load PDF file bytes into app
  const loadPdfBytes = async (bytes: Uint8Array, filename: string, recoveredAnns?: Annotation[], recoveredPages?: PageState[]) => {
    try {
      setIsLoading(true);

      // Decodes pages metadata using PDF.js.
      // We pass a *copy* of the buffer here because pdfjs.getDocument transfers
      // (detaches) the underlying ArrayBuffer to its worker — using the original
      // `bytes` after that point would throw "ArrayBuffer is already detached".
      const loadingTask = pdfjs.getDocument({ data: bytes.slice(0) });
      const doc = await loadingTask.promise;

      // Only update file state after we've confirmed the bytes are valid
      setPdfFileBytes(bytes);
      setPdfFilename(filename);
      setPdfDocument(doc);

      let finalPages: PageState[];
      if (recoveredPages && recoveredPages.length > 0) {
        setPagesState(recoveredPages);
        setAnnotations(recoveredAnns || []);
        // Seed history with recovered data
        setHistory([{ pages: recoveredPages, annotations: recoveredAnns || [] }]);
        setHistoryIndex(0);
        finalPages = recoveredPages;
      } else {
        const pagesInfo = await getPdfPagesInfo(bytes);
        setPagesState(pagesInfo);
        setAnnotations([]);
        // Seed history with fresh data
        setHistory([{ pages: pagesInfo, annotations: [] }]);
        setHistoryIndex(0);
        finalPages = pagesInfo;
      }

      // Extract text blocks for all pages so text-edit mode works immediately
      const blocksMap = new Map<string, PdfTextBlock[]>();
      for (const pageState of finalPages) {
        if (pageState.originalPageIndex === -1) continue; // blank page
        const finalRotation = (pageState.originalRotation + pageState.rotationOffset) % 360;
        const blocks = await extractPageTextBlocks(doc, pageState.originalPageIndex, finalRotation);
        blocksMap.set(pageState.id, blocks);
      }
      setPdfTextBlocks(blocksMap);

      setHasUnsavedChanges(false);
    } catch (err) {
      console.error('Failed to parse PDF document:', err);
      alert('Error loading PDF file. Please ensure it is a valid PDF document.');
    } finally {
      setIsLoading(false);
    }
  };

  // Recover draft trigger
  const handleRecoverDraft = async () => {
    if (draftToRecover) {
      await loadPdfBytes(
        draftToRecover.pdfBytes,
        'recovered_draft.pdf',
        draftToRecover.annotations,
        draftToRecover.pagesState
      );
      setDraftToRecover(null);
    }
  };

  const handleDiscardDraft = async () => {
    await clearDraft();
    setDraftToRecover(null);
  };

  // Upload handler
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = async () => {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        await loadPdfBytes(bytes, file.name);
      };
      reader.readAsArrayBuffer(file);
    }
  };

  // Drag and Drop files
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const reader = new FileReader();
        reader.onload = async () => {
          const bytes = new Uint8Array(reader.result as ArrayBuffer);
          await loadPdfBytes(bytes, file.name);
        };
        reader.readAsArrayBuffer(file);
      }
    }
  };

  // Undo/Redo logic
  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      const state = history[prevIndex];
      setPagesState(JSON.parse(JSON.stringify(state.pages)));
      setAnnotations(JSON.parse(JSON.stringify(state.annotations)));
      setHistoryIndex(prevIndex);
      setSelectedAnnotationId(null);
      setHasUnsavedChanges(true);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      const state = history[nextIndex];
      setPagesState(JSON.parse(JSON.stringify(state.pages)));
      setAnnotations(JSON.parse(JSON.stringify(state.annotations)));
      setHistoryIndex(nextIndex);
      setSelectedAnnotationId(null);
      setHasUnsavedChanges(true);
    }
  };

  // Page alterations
  const handleRotatePage = (pageId: string) => {
    const updatedPages = pagesState.map(p => {
      if (p.id === pageId) {
        return { ...p, rotationOffset: (p.rotationOffset + 90) % 360 };
      }
      return p;
    });
    updatePagesAndAnnotations(updatedPages, annotations);
  };

  const handleDeletePage = (pageId: string) => {
    if (pagesState.length <= 1) {
      alert('A document must contain at least one page.');
      return;
    }
    const updatedPages = pagesState.filter(p => p.id !== pageId);
    const updatedAnns = annotations.filter(a => a.pageId !== pageId);
    updatePagesAndAnnotations(updatedPages, updatedAnns);
    setSelectedAnnotationId(null);
  };

  // Native HTML5 thumbnail drag and drop reordering
  const handleDragStartThumbnail = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDropThumbnail = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIdxStr = e.dataTransfer.getData('text/plain');
    if (sourceIdxStr === '') return;
    const sourceIndex = parseInt(sourceIdxStr);
    
    if (sourceIndex === targetIndex) return;

    const reorderedPages = [...pagesState];
    const [movedPage] = reorderedPages.splice(sourceIndex, 1);
    reorderedPages.splice(targetIndex, 0, movedPage);
    
    updatePagesAndAnnotations(reorderedPages, annotations);
  };

  // Export & download document client-side
  const handleExportPdf = async () => {
    if (!pdfFileBytes) return;
    try {
      setIsLoading(true);
      setStatusMessage('Compiling PDF file...');
      
      const compiledBytes = await compilePdf(pdfFileBytes, pagesState, annotations);
      
      // Save compiled bytes locally via download dialog
      const blob = new Blob([compiledBytes as any], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = pdfFilename.replace('.pdf', '') + '_edited.pdf';
      document.body.appendChild(link);
      link.click();
      
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      // Clear autosave draft on successful download
      await clearDraft();
      setHasUnsavedChanges(false);
      setStatusMessage('PDF Exported Successfully.');
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (error) {
      console.error('Failed to export PDF:', error);
      alert('Error building/downloading PDF file.');
    } finally {
      setIsLoading(false);
    }
  };

  // Coordinate math helpers
  const getRelativeCoordinates = (e: React.MouseEvent<HTMLDivElement>, _pageId: string) => {
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;

    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;

    return { x, y };
  };

  // Adding images & signatures
  const handleInsertImageClick = () => {
    if (imageInputRef.current) {
      imageInputRef.current.click();
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && pagesState.length > 0) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        
        // Add image to center of active/first page
        const firstPageId = pagesState[0].id;
        const newAnn: Annotation = {
          id: `ann-${crypto.randomUUID()}`,
          pageId: firstPageId,
          type: 'image',
          x: 0.35,
          y: 0.35,
          width: 0.3,
          height: 0.3,
          color: '#000000',
          imageSrc: dataUrl,
        };

        const newAnns = [...annotations, newAnn];
        updatePagesAndAnnotations(pagesState, newAnns);
        setSelectedAnnotationId(newAnn.id);
        setActiveTool('select');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleInsertSignature = (dataUrl: string) => {
    if (pagesState.length > 0) {
      const targetPageId = pagesState[0].id; // Insert on first page by default
      const newAnn: Annotation = {
        id: `ann-${crypto.randomUUID()}`,
        pageId: targetPageId,
        type: 'signature',
        x: 0.4,
        y: 0.4,
        width: 0.25,
        height: 0.15,
        color: currentColor,
        imageSrc: dataUrl,
      };

      const newAnns = [...annotations, newAnn];
      updatePagesAndAnnotations(pagesState, newAnns);
      setSelectedAnnotationId(newAnn.id);
      setIsSignatureModalOpen(false);
      setActiveTool('select');
    }
  };

  // Drawing overlay canvas events
  const handlePageMouseDown = (e: React.MouseEvent<HTMLDivElement>, pageId: string) => {
    if (activeTool === 'select') return;

    const { x, y } = getRelativeCoordinates(e, pageId);
    isDrawingRef.current = true;
    dragStartPosRef.current = { x, y };

    if (activeTool === 'draw') {
      drawingPointsRef.current = [{ x, y }];
      const newAnn: Annotation = {
        id: `temp-draw`,
        pageId,
        type: 'draw',
        x: x,
        y: y,
        width: 0,
        height: 0,
        color: currentColor,
        strokeWidth: currentStrokeWidth,
        points: [{ x, y }],
      };
      tempDrawAnnotationRef.current = newAnn;
    } else if (activeTool === 'shape') {
      // Seed shape
      const newAnn: Annotation = {
        id: `temp-shape`,
        pageId,
        type: 'shape',
        shapeType: currentShapeType,
        x: x,
        y: y,
        width: 0,
        height: 0,
        color: currentColor,
        strokeWidth: currentStrokeWidth,
        isFilled: currentIsFilled,
        fillColor: currentIsFilled ? currentFillColor : undefined,
      };
      tempDrawAnnotationRef.current = newAnn;
    }
  };

  const handlePageMouseMove = (e: React.MouseEvent<HTMLDivElement>, pageId: string) => {
    if (!isDrawingRef.current || !dragStartPosRef.current) return;

    const { x, y } = getRelativeCoordinates(e, pageId);

    if (activeTool === 'draw' && tempDrawAnnotationRef.current) {
      drawingPointsRef.current.push({ x, y });
      
      // Calculate boundaries for the bounding box
      const xs = drawingPointsRef.current.map(p => p.x);
      const ys = drawingPointsRef.current.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      tempDrawAnnotationRef.current = {
        ...tempDrawAnnotationRef.current,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        points: [...drawingPointsRef.current],
      };
      
      // Re-trigger layout render for temp draw path
      setAnnotations(prev => {
        const filtered = prev.filter(a => a.id !== 'temp-draw');
        return [...filtered, tempDrawAnnotationRef.current!];
      });
    } else if (activeTool === 'shape' && tempDrawAnnotationRef.current) {
      const startX = dragStartPosRef.current.x;
      const startY = dragStartPosRef.current.y;
      
      const width = x - startX;
      const height = y - startY;

      // Handle dragging backwards (negative values)
      const absWidth = Math.abs(width);
      const absHeight = Math.abs(height);
      const finalX = width < 0 ? x : startX;
      const finalY = height < 0 ? y : startY;

      tempDrawAnnotationRef.current = {
        ...tempDrawAnnotationRef.current,
        x: finalX,
        y: finalY,
        width: absWidth,
        height: absHeight,
      };

      setAnnotations(prev => {
        const filtered = prev.filter(a => a.id !== 'temp-shape');
        return [...filtered, tempDrawAnnotationRef.current!];
      });
    }
  };

  const handlePageMouseUp = (e: React.MouseEvent<HTMLDivElement>, pageId: string) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    const { x, y } = getRelativeCoordinates(e, pageId);

    if (activeTool === 'draw' && tempDrawAnnotationRef.current) {
      // Save final drawing annotation
      const finalAnn: Annotation = {
        ...tempDrawAnnotationRef.current,
        id: `ann-${crypto.randomUUID()}`,
      };
      tempDrawAnnotationRef.current = null;
      
      // Clear temp and write permanent
      const updatedAnns = annotations.filter(a => a.id !== 'temp-draw').concat(finalAnn);
      updatePagesAndAnnotations(pagesState, updatedAnns);
    } else if (activeTool === 'shape' && tempDrawAnnotationRef.current) {
      // Save shape annotation
      const finalAnn: Annotation = {
        ...tempDrawAnnotationRef.current,
        id: `ann-${crypto.randomUUID()}`,
      };
      tempDrawAnnotationRef.current = null;
      
      const updatedAnns = annotations.filter(a => a.id !== 'temp-shape').concat(finalAnn);
      updatePagesAndAnnotations(pagesState, updatedAnns);
    } else if (activeTool === 'text') {
      // Create a fresh text annotation on mouse-up location
      const newAnn: Annotation = {
        id: `ann-${crypto.randomUUID()}`,
        pageId,
        type: 'text',
        x: x,
        y: y,
        width: 0.25,
        height: 0.05,
        color: currentColor,
        text: 'Text box (double click)',
        fontSize: currentFontSize,
      };
      const updatedAnns = [...annotations, newAnn];
      updatePagesAndAnnotations(pagesState, updatedAnns);
      setSelectedAnnotationId(newAnn.id);
      setActiveTool('select');
    }
    
    dragStartPosRef.current = null;
  };

  // Move and Resize Annotations logic
  const handleAnnMouseDown = (e: React.MouseEvent, annId: string) => {
    if (activeTool !== 'select') return;
    e.stopPropagation(); // Stop click from propagating to canvas drawing trigger

    setSelectedAnnotationId(annId);
    isDraggingAnnotationRef.current = true;
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };

    const targetAnn = annotations.find(a => a.id === annId);
    if (targetAnn) {
      selectedAnnOriginalBoundsRef.current = {
        x: targetAnn.x,
        y: targetAnn.y,
        w: targetAnn.width,
        h: targetAnn.height,
      };
    }
  };

  const handleResizeHandleMouseDown = (e: React.MouseEvent, annId: string, handle: 'nw' | 'ne' | 'se' | 'sw') => {
    e.stopPropagation();
    setSelectedAnnotationId(annId);
    isResizingAnnotationRef.current = handle;
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };

    const targetAnn = annotations.find(a => a.id === annId);
    if (targetAnn) {
      selectedAnnOriginalBoundsRef.current = {
        x: targetAnn.x,
        y: targetAnn.y,
        w: targetAnn.width,
        h: targetAnn.height,
      };
    }
  };

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (!dragStartPosRef.current || !selectedAnnOriginalBoundsRef.current || !selectedAnnotationId) return;

    const pageContainer = document.querySelector(`[data-ann-container="${selectedAnnotationId}"]`);
    if (!pageContainer) return;

    const rect = pageContainer.getBoundingClientRect();
    const deltaX = (e.clientX - dragStartPosRef.current.x) / rect.width;
    const deltaY = (e.clientY - dragStartPosRef.current.y) / rect.height;

    const orig = selectedAnnOriginalBoundsRef.current;

    setAnnotations(prev => {
      return prev.map(ann => {
        if (ann.id !== selectedAnnotationId) return ann;

        if (isDraggingAnnotationRef.current) {
          // Prevent dragging completely outside bounds
          const nextX = Math.max(0, Math.min(1 - ann.width, orig.x + deltaX));
          const nextY = Math.max(0, Math.min(1 - ann.height, orig.y + deltaY));
          return {
            ...ann,
            x: nextX,
            y: nextY,
          };
        } else if (isResizingAnnotationRef.current) {
          const handle = isResizingAnnotationRef.current;
          let nextX = ann.x;
          let nextY = ann.y;
          let nextW = ann.width;
          let nextH = ann.height;

          // Resize calculations depending on anchor handle dragged
          if (handle === 'se') {
            nextW = Math.max(0.02, orig.w + deltaX);
            nextH = Math.max(0.02, orig.h + deltaY);
          } else if (handle === 'sw') {
            nextX = Math.max(0, Math.min(orig.x + orig.w - 0.02, orig.x + deltaX));
            nextW = Math.max(0.02, orig.w - (nextX - orig.x));
            nextH = Math.max(0.02, orig.h + deltaY);
          } else if (handle === 'nw') {
            nextX = Math.max(0, Math.min(orig.x + orig.w - 0.02, orig.x + deltaX));
            nextY = Math.max(0, Math.min(orig.y + orig.h - 0.02, orig.y + deltaY));
            nextW = Math.max(0.02, orig.w - (nextX - orig.x));
            nextH = Math.max(0.02, orig.h - (nextY - orig.y));
          } else if (handle === 'ne') {
            nextY = Math.max(0, Math.min(orig.y + orig.h - 0.02, orig.y + deltaY));
            nextW = Math.max(0.02, orig.w + deltaX);
            nextH = Math.max(0.02, orig.h - (nextY - orig.y));
          }

          // Bounds capping
          if (nextX + nextW > 1) nextW = 1 - nextX;
          if (nextY + nextH > 1) nextH = 1 - nextY;

          return {
            ...ann,
            x: nextX,
            y: nextY,
            width: nextW,
            height: nextH,
          };
        }
        return ann;
      });
    });
  }, [selectedAnnotationId]);

  const handleGlobalMouseUp = useCallback(() => {
    if (isDraggingAnnotationRef.current || isResizingAnnotationRef.current) {
      isDraggingAnnotationRef.current = false;
      isResizingAnnotationRef.current = null;
      dragStartPosRef.current = null;
      selectedAnnOriginalBoundsRef.current = null;
      
      // Save changes into history stack after dragging/resizing finishes
      updatePagesAndAnnotations(pagesState, annotations);
    }
  }, [pagesState, annotations]);

  useEffect(() => {
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [handleGlobalMouseMove, handleGlobalMouseUp]);

  // Delete annotation key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedAnnotationId) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          // Don't delete the annotation if user is typing inside a text editor
          const tag = document.activeElement?.tagName;
          const ce = (document.activeElement as HTMLElement)?.contentEditable;
          if (tag === 'TEXTAREA' || tag === 'INPUT' || ce === 'true') {
            return;
          }
          const updatedAnns = annotations.filter(a => a.id !== selectedAnnotationId);
          updatePagesAndAnnotations(pagesState, updatedAnns);
          setSelectedAnnotationId(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAnnotationId, annotations, pagesState]);

  // Modify text inside textbox
  const handleTextChange = (annId: string, value: string) => {
    const updated = annotations.map(ann => {
      if (ann.id === annId) {
        return { ...ann, text: value };
      }
      return ann;
    });
    setAnnotations(updated);
    setHasUnsavedChanges(true);
  };

  const handleTextBlur = () => {
    // Commit the text changes to history on blur
    pushToHistory(pagesState, annotations);
  };

  /**
   * Called by TextEditOverlay when the user finishes editing a PDF text block.
   * Creates or updates a 'text-edit' annotation that replaces the original text.
   */
  const handleTextEdit = useCallback((block: PdfTextBlock, newText: string) => {
    const pageState = pagesState.find(p => p.originalPageIndex === block.pageIndex);
    if (!pageState) return;

    const existingAnn = annotations.find(
      a => a.type === 'text-edit' && a.pageId === pageState.id && a.originalBlockId === block.id
    );

    let updatedAnns: Annotation[];
    if (existingAnn) {
      // Update the existing edit
      updatedAnns = annotations.map(a =>
        a.id === existingAnn.id ? { ...a, editedText: newText } : a
      );
    } else {
      // Create a new text-edit annotation
      const newAnn: Annotation = {
        id: `ann-${crypto.randomUUID()}`,
        pageId: pageState.id,
        type: 'text-edit',
        x: block.x,
        y: block.y,
        width: Math.max(block.width, 0.01),
        height: Math.max(block.height, 0.01),
        color: '#000000',
        fontSize: block.fontSize,
        originalBlockId: block.id,
        originalText: block.text,
        editedText: newText,
      };
      updatedAnns = [...annotations, newAnn];
    }

    updatePagesAndAnnotations(pagesState, updatedAnns);
  }, [annotations, pagesState]);

  const handleSelectAnnAttributeChange = (color: string, size?: number) => {
    if (!selectedAnnotationId) return;
    const updated = annotations.map(ann => {
      if (ann.id === selectedAnnotationId) {
        return {
          ...ann,
          color,
          fontSize: size !== undefined ? size : ann.fontSize,
        };
      }
      return ann;
    });
    updatePagesAndAnnotations(pagesState, updated);
  };

  // Find selected annotation properties
  const selectedAnnotation = annotations.find(a => a.id === selectedAnnotationId);

  return (
    <div className={`flex flex-col h-screen ${isLightTheme ? 'light-theme' : ''}`} style={{ backgroundColor: 'hsl(var(--bg-primary))', color: 'hsl(var(--text-primary))' }}>
      
      {/* Draft recovery notice bar */}
      {draftToRecover && (
        <div className="glass-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', borderBottom: '1px solid hsl(var(--border))', zIndex: 100 }}>
          <div style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText size={16} style={{ color: 'hsl(var(--accent))' }} />
            <span>Unsaved working draft found from previous session. Do you want to restore it?</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ padding: '4px 10px', fontSize: '12px' }} onClick={handleDiscardDraft}>Discard</button>
            <button className="primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={handleRecoverDraft}>Restore Draft</button>
          </div>
        </div>
      )}

      {/* Top Header */}
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <FileText size={22} style={{ color: 'hsl(var(--accent))' }} />
          <h1 style={{ fontSize: '16px', fontWeight: 600, margin: 0, letterSpacing: 'normal' }}>
            {pdfFilename ? pdfFilename : 'Canvas PDF Editor'}
          </h1>
          {statusMessage && (
            <span style={{ fontSize: '12px', color: 'hsl(var(--text-muted))', fontStyle: 'italic', marginLeft: '12px' }}>
              {statusMessage}
            </span>
          )}
        </div>

        {/* Primary App Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button 
            className="icon-only" 
            onClick={() => setIsLightTheme(!isLightTheme)}
            title={isLightTheme ? "Switch to Dark Mode" : "Switch to Light Mode"}
          >
            {isLightTheme ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          
          <div style={{ display: 'flex', borderRight: '1px solid hsl(var(--border))', paddingRight: '12px', marginRight: '4px' }}>
            <button 
              className="icon-only" 
              onClick={handleUndo} 
              disabled={historyIndex <= 0}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 size={18} />
            </button>
            <button 
              className="icon-only" 
              onClick={handleRedo} 
              disabled={historyIndex >= history.length - 1}
              style={{ marginLeft: '4px' }}
              title="Redo (Ctrl+Y)"
            >
              <Redo2 size={18} />
            </button>
          </div>

          <button onClick={() => fileInputRef.current?.click()}>
            <Upload size={18} />
            <span>Open PDF</span>
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept=".pdf" 
            style={{ display: 'none' }} 
          />
          <input 
            type="file" 
            ref={imageInputRef} 
            onChange={handleImageUpload} 
            accept="image/*" 
            style={{ display: 'none' }} 
          />

          <button 
            className="primary" 
            onClick={handleExportPdf}
            disabled={!pdfFileBytes}
          >
            <Download size={18} />
            <span>Download</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="app-container">
        
        {/* Left Sidebar Thumbnail Nav */}
        <div className={`sidebar-panel ${isSidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-header">
            <span>Pages ({pagesState.length})</span>
            <button 
              className="icon-only" 
              onClick={() => setIsSidebarCollapsed(true)}
              style={{ padding: '2px', border: 'none', background: 'transparent' }}
            >
              <ChevronLeft size={16} />
            </button>
          </div>

          {pdfDocument && pagesState.length > 0 ? (
            <div className="thumbnail-list">
              {pagesState.map((page, idx) => (
                <div 
                  key={page.id} 
                  className="thumbnail-item-wrapper"
                  draggable
                  onDragStart={(e) => handleDragStartThumbnail(e, idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDropThumbnail(e, idx)}
                >
                  <div className="thumbnail-item">
                    <PageRenderer 
                      pdfDocument={pdfDocument} 
                      pageState={page} 
                      scale={0.2} 
                    />
                    
                    {/* Hover thumbnails quick controls */}
                    <div className="thumbnail-actions">
                      <button 
                        className="icon-only" 
                        style={{ padding: '4px', background: 'hsl(var(--bg-secondary))' }}
                        onClick={() => handleRotatePage(page.id)}
                        title="Rotate Page"
                      >
                        <RotateCw size={12} />
                      </button>
                      <button 
                        className="icon-only" 
                        style={{ padding: '4px', background: 'hsl(var(--bg-secondary))', color: 'hsl(var(--danger))' }}
                        onClick={() => handleDeletePage(page.id)}
                        title="Delete Page"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <div className={`thumbnail-badge ${page.originalPageIndex === -1 ? 'blank' : ''}`}>
                    {idx + 1} {page.originalPageIndex === -1 ? '(Blank)' : ''}
                  </div>
                </div>
              ))}
              
              <button 
                onClick={addBlankPage} 
                style={{ width: '100%', justifyContent: 'center', marginTop: '10px' }}
              >
                <Plus size={16} />
                <span>Blank Page</span>
              </button>
            </div>
          ) : (
            <div style={{ padding: '20px', textAlign: 'center', fontSize: '13px', color: 'hsl(var(--text-muted))' }}>
              No document open
            </div>
          )}
        </div>

        {/* Sidebar expansion tab */}
        {isSidebarCollapsed && (
          <button 
            className="icon-only glass-panel"
            style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
              zIndex: 8,
              borderRadius: '50%',
              boxShadow: 'var(--shadow-md)',
            }}
            onClick={() => setIsSidebarCollapsed(false)}
          >
            <ChevronRight size={18} />
          </button>
        )}

        {/* Editor Workspace Panel */}
        <div 
          className="workspace-viewport" 
          ref={workspaceRef}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          {pdfDocument && pagesState.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '0 auto', minHeight: 'min-content' }}>
              {pagesState.map((page) => (
                <div 
                  key={page.id}
                  className="pdf-page-container"
                  style={{
                    width: (page.rotationOffset % 180 === 0 ? page.width : page.height) * zoom,
                    height: (page.rotationOffset % 180 === 0 ? page.height : page.width) * zoom,
                  }}
                  data-ann-page-container={page.id}
                >
                  <PageRenderer 
                    pdfDocument={pdfDocument} 
                    pageState={page} 
                    scale={zoom} 
                    className="pdf-page-canvas"
                  />

                  {/* Draw layer on top of page */}
                  <div 
                    className="annotation-overlay-layer"
                    data-ann-container-page={page.id}
                    onMouseDown={(e) => editMode === 'annotate' ? handlePageMouseDown(e, page.id) : undefined}
                    onMouseMove={(e) => editMode === 'annotate' ? handlePageMouseMove(e, page.id) : undefined}
                    onMouseUp={(e) => editMode === 'annotate' ? handlePageMouseUp(e, page.id) : undefined}
                  >
                    {/* Text-edit overlay: sits on top, only visible in edit-text mode */}
                    <TextEditOverlay
                      textBlocks={pdfTextBlocks.get(page.id) || []}
                      annotations={annotations}
                      pageId={page.id}
                      scale={zoom}
                      canvasWidth={(page.rotationOffset % 180 === 0 ? page.width : page.height) * zoom}
                      canvasHeight={(page.rotationOffset % 180 === 0 ? page.height : page.width) * zoom}
                      onTextEdit={handleTextEdit}
                      active={editMode === 'edit-text'}
                    />
                    {/* Render persistent annotations */}
                    {annotations
                      .filter(ann => ann.pageId === page.id)
                      .map(ann => {
                        const isSelected = ann.id === selectedAnnotationId;
                        return (
                          <div
                            key={ann.id}
                            className={`annotation-element ${isSelected ? 'selected' : ''}`}
                            style={{
                              left: `${ann.x * 100}%`,
                              top: `${ann.y * 100}%`,
                              width: `${ann.width * 100}%`,
                              height: `${ann.height * 100}%`,
                              zIndex: isSelected ? 10 : 6,
                            }}
                            data-ann-container={ann.id}
                            onMouseDown={(e) => handleAnnMouseDown(e, ann.id)}
                          >
                            {ann.type === 'text' && (
                              <textarea
                                className="annotation-text-element"
                                style={{
                                  color: ann.color,
                                  fontSize: `${(ann.fontSize || 14) * zoom}px`,
                                }}
                                value={ann.text || ''}
                                onChange={(e) => handleTextChange(ann.id, e.target.value)}
                                onBlur={handleTextBlur}
                                placeholder="Edit text..."
                                disabled={activeTool !== 'select'}
                              />
                            )}

                            {ann.type === 'draw' && ann.points && (
                              <svg className="annotation-svg-drawing">
                                <polyline
                                  points={ann.points
                                    .map(p => `${p.x * 100}%,${p.y * 100}%`)
                                    .join(' ')}
                                  fill="none"
                                  stroke={ann.color}
                                  strokeWidth={(ann.strokeWidth || 2) * zoom}
                                />
                              </svg>
                            )}

                            {ann.type === 'shape' && (
                              <svg className="annotation-svg-drawing">
                                {ann.shapeType === 'rectangle' && (
                                  <rect
                                    x={0}
                                    y={0}
                                    width="100%"
                                    height="100%"
                                    fill={ann.isFilled ? ann.fillColor || 'transparent' : 'transparent'}
                                    stroke={ann.color}
                                    strokeWidth={(ann.strokeWidth || 2) * zoom}
                                  />
                                )}
                                {ann.shapeType === 'circle' && (
                                  <ellipse
                                    cx="50%"
                                    cy="50%"
                                    rx="50%"
                                    ry="50%"
                                    fill={ann.isFilled ? ann.fillColor || 'transparent' : 'transparent'}
                                    stroke={ann.color}
                                    strokeWidth={(ann.strokeWidth || 2) * zoom}
                                  />
                                )}
                                {(ann.shapeType === 'line' || ann.shapeType === 'arrow') && (
                                  <g>
                                    <line
                                      x1="0%"
                                      y1="0%"
                                      x2="100%"
                                      y2="100%"
                                      stroke={ann.color}
                                      strokeWidth={(ann.strokeWidth || 2) * zoom}
                                    />
                                    {ann.shapeType === 'arrow' && (
                                      // Render symbolic arrowhead inside relative svg bounds
                                      <polygon
                                        points="100%,100% 85%,90% 90%,85%"
                                        fill={ann.color}
                                        style={{ transformOrigin: 'center' }}
                                      />
                                    )}
                                  </g>
                                )}
                              </svg>
                            )}

                            {(ann.type === 'image' || ann.type === 'signature') && ann.imageSrc && (
                              <img
                                src={ann.imageSrc}
                                style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
                                alt="Overlay annotation"
                              />
                            )}

                            {/* Resize handles */}
                            {isSelected && activeTool === 'select' && (
                              <>
                                <div className="resize-handle nw" onMouseDown={(e) => handleResizeHandleMouseDown(e, ann.id, 'nw')} />
                                <div className="resize-handle ne" onMouseDown={(e) => handleResizeHandleMouseDown(e, ann.id, 'ne')} />
                                <div className="resize-handle se" onMouseDown={(e) => handleResizeHandleMouseDown(e, ann.id, 'se')} />
                                <div className="resize-handle sw" onMouseDown={(e) => handleResizeHandleMouseDown(e, ann.id, 'sw')} />
                              </>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="dropzone" onClick={() => fileInputRef.current?.click()}>
              <Upload className="dropzone-icon" />
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>Drag & Drop PDF here</h3>
                <p style={{ fontSize: '13px', color: 'hsl(var(--text-muted))' }}>
                  or click to browse files
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Toolbar floating controls */}
        {pdfDocument && (
          <div 
            className="glass-panel" 
            style={{
              position: 'fixed',
              bottom: '24px',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              padding: '6px',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 20,
              gap: '4px',
            }}
          >
            {[
              { id: 'select', label: 'Select Tool', icon: <MousePointer size={18} /> },
              { id: 'text', label: 'Add Text Box', icon: <Type size={18} /> },
              { id: 'draw', label: 'Pen Tool', icon: <PenTool size={18} /> },
              { id: 'shape', label: 'Draw Shapes', icon: <Square size={18} /> },
              { id: 'signature', label: 'Sign Document', icon: <span style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '14px' }}>S</span> },
              { id: 'image', label: 'Insert Image', icon: <ImageIcon size={18} /> },
            ].map(tool => (
              <button
                key={tool.id}
                className={`icon-only ${activeTool === tool.id && editMode === 'annotate' ? 'primary' : ''}`}
                style={{
                  border: 'none',
                  background: activeTool === tool.id && editMode === 'annotate' ? 'hsl(var(--accent))' : 'transparent',
                  opacity: editMode === 'edit-text' ? 0.4 : 1,
                }}
                onClick={() => {
                  setEditMode('annotate');
                  if (tool.id === 'signature') {
                    setIsSignatureModalOpen(true);
                  } else if (tool.id === 'image') {
                    handleInsertImageClick();
                  } else {
                    setActiveTool(tool.id as any);
                    setSelectedAnnotationId(null);
                  }
                }}
                title={tool.label}
              >
                {tool.icon}
              </button>
            ))}

            {/* Separator */}
            <div style={{ width: '1px', backgroundColor: 'hsl(var(--border))', margin: '4px' }} />

            {/* Edit Text Mode Button */}
            <button
              id="edit-text-mode-btn"
              className={`icon-only ${editMode === 'edit-text' ? 'primary' : ''}`}
              style={{
                border: 'none',
                background: editMode === 'edit-text' ? 'hsl(var(--accent))' : 'transparent',
                gap: '6px',
                paddingLeft: '10px',
                paddingRight: '10px',
              }}
              onClick={() => {
                setEditMode(prev => prev === 'edit-text' ? 'annotate' : 'edit-text');
                setSelectedAnnotationId(null);
              }}
              title="Edit PDF Text (Word-like mode)"
            >
              <Type size={16} />
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Edit Text</span>
            </button>

            {/* Separator */}
            <div style={{ width: '1px', backgroundColor: 'hsl(var(--border))', margin: '4px' }} />

            {/* Zoom Controls */}
            <button 
              className="icon-only" 
              style={{ border: 'none', background: 'transparent' }}
              onClick={() => setZoom(prev => Math.max(0.5, prev - 0.2))}
              title="Zoom Out"
            >
              <ZoomOut size={18} />
            </button>
            <span style={{ display: 'flex', alignItems: 'center', fontSize: '13px', padding: '0 8px', minWidth: '48px', justifyContent: 'center' }}>
              {Math.round(zoom * 100)}%
            </span>
            <button 
              className="icon-only" 
              style={{ border: 'none', background: 'transparent' }}
              onClick={() => setZoom(prev => Math.min(3.0, prev + 0.2))}
              title="Zoom In"
            >
              <ZoomIn size={18} />
            </button>
          </div>
        )}

        {/* Right Properties Panel Inspector */}
        {pdfDocument && (
          <div className="properties-panel">
            <div className="properties-header">Inspector</div>
            
            <div className="properties-content">
              {editMode === 'edit-text' && (
                <div style={{
                  padding: '10px 12px',
                  marginBottom: '12px',
                  borderRadius: 'var(--radius)',
                  background: 'hsl(var(--accent-glow))',
                  border: '1px solid hsl(var(--accent) / 0.3)',
                  fontSize: '12px',
                  lineHeight: 1.5,
                  color: 'hsl(var(--text-primary))',
                }}>
                  <strong style={{ color: 'hsl(var(--accent))' }}>✏️ Edit Text Mode</strong>
                  <br />
                  Click any text on the page to edit it inline.
                  <br />
                  <span style={{ color: 'hsl(var(--text-muted))' }}>
                    Press Enter to confirm, Esc to cancel.
                  </span>
                  <br /><br />
                  <span style={{ color: 'hsl(var(--text-muted))' }}>
                    ⚠️ Font will be converted to Helvetica on export (PDF format limitation).
                  </span>
                </div>
              )}
              {selectedAnnotation ? (
                <>
                  <div style={{ fontSize: '13px', display: 'flex', gap: '8px', color: 'hsl(var(--text-muted))', paddingBottom: '10px', borderBottom: '1px solid hsl(var(--border))' }}>
                    <strong>Type:</strong> <span style={{ textTransform: 'capitalize' }}>{selectedAnnotation.type}</span>
                  </div>

                  {/* Color selector */}
                  <div className="property-group">
                    <div className="property-label">Stroke Color</div>
                    <div className="color-picker">
                      {['#ff0000', '#0000ff', '#000000', '#00aa00', '#ffaa00', '#aa00ff'].map(c => (
                        <div
                          key={c}
                          className={`color-option ${selectedAnnotation.color === c ? 'active' : ''}`}
                          style={{ backgroundColor: c }}
                          onClick={() => {
                            handleSelectAnnAttributeChange(c);
                            setCurrentColor(c);
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* FontSize selector (Text specific) */}
                  {selectedAnnotation.type === 'text' && (
                    <div className="property-group">
                      <div className="property-label">Font Size (px)</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <input
                          type="range"
                          min="10"
                          max="40"
                          value={selectedAnnotation.fontSize || 14}
                          onChange={(e) => {
                            const size = parseInt(e.target.value);
                            handleSelectAnnAttributeChange(selectedAnnotation.color, size);
                            setCurrentFontSize(size);
                          }}
                          style={{ flex: 1 }}
                        />
                        <span style={{ fontSize: '13px', width: '28px', textAlign: 'right' }}>
                          {selectedAnnotation.fontSize || 14}
                        </span>
                      </div>
                    </div>
                  )}

                  <button
                    style={{
                      marginTop: '20px',
                      color: 'hsl(var(--danger))',
                      borderColor: 'rgba(239, 68, 68, 0.2)',
                      width: '100%',
                      justifyContent: 'center',
                    }}
                    onClick={() => {
                      const updatedAnns = annotations.filter(a => a.id !== selectedAnnotationId);
                      updatePagesAndAnnotations(pagesState, updatedAnns);
                      setSelectedAnnotationId(null);
                    }}
                  >
                    <Trash2 size={16} />
                    <span>Delete Annotation</span>
                  </button>
                </>
              ) : (
                <>
                  <div className="property-group">
                    <div className="property-label">Active Palette</div>
                    <div className="color-picker">
                      {['#ff0000', '#0000ff', '#000000', '#00aa00', '#ffaa00', '#aa00ff'].map(c => (
                        <div
                          key={c}
                          className={`color-option ${currentColor === c ? 'active' : ''}`}
                          style={{ backgroundColor: c }}
                          onClick={() => setCurrentColor(c)}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="property-group">
                    <div className="property-label">Brush Size ({currentStrokeWidth}px)</div>
                    <input
                      type="range"
                      min="1"
                      max="12"
                      value={currentStrokeWidth}
                      onChange={(e) => setCurrentStrokeWidth(parseInt(e.target.value))}
                    />
                  </div>

                  <div className="property-group">
                    <div className="property-label">Shape Options</div>
                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                      {[
                        { id: 'rectangle', label: 'Rectangle' },
                        { id: 'circle', label: 'Circle' },
                        { id: 'line', label: 'Line' },
                        { id: 'arrow', label: 'Arrow' },
                      ].map(shape => (
                        <button
                          key={shape.id}
                          style={{
                            flex: 1,
                            fontSize: '11px',
                            padding: '6px 4px',
                            justifyContent: 'center',
                            borderColor: currentShapeType === shape.id ? 'hsl(var(--accent))' : 'hsl(var(--border))',
                            background: currentShapeType === shape.id ? 'hsl(var(--accent-glow))' : 'transparent',
                            color: currentShapeType === shape.id ? 'hsl(var(--accent))' : 'hsl(var(--text-primary))',
                          }}
                          onClick={() => {
                            setCurrentShapeType(shape.id as any);
                            setActiveTool('shape');
                          }}
                        >
                          {shape.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ fontSize: '12px', color: 'hsl(var(--text-muted))', textAlign: 'center', borderTop: '1px dashed hsl(var(--border))', paddingTop: '20px', marginTop: '20px' }}>
                    Select an annotation to adjust its individual properties.
                  </div>
                </>
              )}
            </div>
          </div>
        )}

      </div>

      {/* Signature drawing Dialog Modal */}
      {isSignatureModalOpen && (
        <dialog open>
          <div className="dialog-header">
            <span className="dialog-title">Create Signature</span>
            <button 
              className="icon-only" 
              onClick={() => setIsSignatureModalOpen(false)}
              style={{ border: 'none', background: 'transparent' }}
            >
              <X size={18} />
            </button>
          </div>
          
          <SignaturePad 
            onSave={handleInsertSignature} 
            onClose={() => setIsSignatureModalOpen(false)} 
          />
        </dialog>
      )}

      {/* Full screen loader loading task */}
      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <span style={{ fontSize: '14px', fontWeight: 500 }}>
            {statusMessage ? statusMessage : 'Loading Document...'}
          </span>
        </div>
      )}

    </div>
  );
}
