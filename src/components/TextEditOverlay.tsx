import React, { useRef, useEffect, useCallback } from 'react';
import type { PdfTextBlock } from '../utils/pdf-text-extractor';
import type { Annotation } from '../utils/pdf-manager';

interface TextEditOverlayProps {
  /** Text blocks extracted from the PDF page */
  textBlocks: PdfTextBlock[];
  /** Current annotations for this page (to find existing edits) */
  annotations: Annotation[];
  /** The page's unique ID */
  pageId: string;
  /** Scale factor applied to the page canvas */
  scale: number;
  /** Canvas pixel width (already scaled) */
  canvasWidth: number;
  /** Canvas pixel height (already scaled) */
  canvasHeight: number;
  /** Called when the user finishes editing a text block */
  onTextEdit: (block: PdfTextBlock, newText: string) => void;
  /** Whether this overlay is active (text-edit mode is on) */
  active: boolean;
}

/**
 * Renders transparent contenteditable divs exactly over each PDF text block.
 * When the user clicks one, they can type to replace the original text.
 */
export const TextEditOverlay: React.FC<TextEditOverlayProps> = ({
  textBlocks,
  annotations,
  pageId,
  scale,
  canvasWidth,
  canvasHeight,
  onTextEdit,
  active,
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Find the current edited text for a block (if any)
  const getEditedText = useCallback((blockId: string): string | null => {
    const ann = annotations.find(
      a => a.type === 'text-edit' && a.pageId === pageId && a.originalBlockId === blockId
    );
    return ann?.editedText ?? null;
  }, [annotations, pageId]);

  const handleBlur = useCallback((block: PdfTextBlock, el: HTMLDivElement) => {
    const newText = el.innerText;
    if (newText !== block.text) {
      onTextEdit(block, newText);
    }
  }, [onTextEdit]);

  const handleKeyDown = useCallback((
    e: React.KeyboardEvent<HTMLDivElement>,
    block: PdfTextBlock,
    el: HTMLDivElement
  ) => {
    // Shift+Enter = newline, plain Enter = commit
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      el.blur();
    }
    // Escape = revert
    if (e.key === 'Escape') {
      const edited = getEditedText(block.id);
      el.innerText = edited ?? block.text;
      el.blur();
    }
  }, [getEditedText]);

  if (!active) return null;

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: canvasWidth,
        height: canvasHeight,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      {textBlocks.map(block => {
        const editedText = getEditedText(block.id);
        const displayText = editedText ?? block.text;
        const isEdited = editedText !== null && editedText !== block.text;

        // Convert normalized coords → canvas pixels
        const left = block.x * canvasWidth;
        const top = block.y * canvasHeight;
        const width = Math.max(block.width * canvasWidth, 20);
        const height = Math.max(block.height * canvasHeight, 14);

        // Scale font size proportionally
        const fontSizePx = Math.max(block.fontSize * scale, 8);

        return (
          <div
            key={block.id}
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            title={`Click to edit: "${block.text}"`}
            style={{
              position: 'absolute',
              left,
              top,
              width,
              minHeight: height,
              fontSize: fontSizePx,
              fontFamily: 'Helvetica, Arial, sans-serif',
              lineHeight: 1.2,
              color: isEdited ? 'rgba(30, 100, 220, 1)' : 'transparent',
              background: isEdited ? '#ffffff' : 'transparent',
              border: 'none',
              outline: 'none',
              padding: '1px 2px',
              margin: 0,
              boxSizing: 'border-box',
              cursor: 'text',
              pointerEvents: 'all',
              whiteSpace: 'pre',
              overflow: 'visible',
              borderRadius: '2px',
              transition: 'background 0.15s, color 0.15s',
              // Show a subtle blue tint on hover to indicate editability
            }}
            onMouseEnter={e => {
              const el = e.currentTarget;
              el.style.background = isEdited ? '#ffffff' : 'rgba(59, 130, 246, 0.08)';
              el.style.outline = '1px solid rgba(59, 130, 246, 0.35)';
              if (!isEdited) el.style.color = 'rgba(0,0,0,0.01)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget;
              if (document.activeElement !== el) {
                el.style.background = isEdited ? '#ffffff' : 'transparent';
                el.style.outline = 'none';
                if (!isEdited) el.style.color = 'transparent';
              }
            }}
            onFocus={e => {
              const el = e.currentTarget;
              el.style.background = 'rgba(255,255,255,0.92)';
              el.style.outline = '2px solid rgba(59, 130, 246, 0.7)';
              el.style.color = '#111';
              el.style.zIndex = '20';
              el.style.boxShadow = '0 2px 8px rgba(59,130,246,0.15)';
              // Select all text on focus for easy replacement
              const range = document.createRange();
              range.selectNodeContents(el);
              const sel = window.getSelection();
              sel?.removeAllRanges();
              sel?.addRange(range);
            }}
            onBlur={e => {
              const el = e.currentTarget;
              el.style.background = isEdited ? '#ffffff' : 'transparent';
              el.style.outline = 'none';
              el.style.color = isEdited ? 'rgba(30, 100, 220, 1)' : 'transparent';
              el.style.zIndex = '';
              el.style.boxShadow = 'none';
              handleBlur(block, el);
            }}
            onKeyDown={e => handleKeyDown(e, block, e.currentTarget)}
          >
            {displayText}
          </div>
        );
      })}
    </div>
  );
};
