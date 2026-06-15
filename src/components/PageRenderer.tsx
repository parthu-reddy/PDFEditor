import React, { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PageState } from '../utils/pdf-manager';

interface PageRendererProps {
  pdfDocument: pdfjs.PDFDocumentProxy;
  pageState: PageState;
  scale: number;
  onRendered?: (canvas: HTMLCanvasElement) => void;
  className?: string;
}

export const PageRenderer: React.FC<PageRendererProps> = ({
  pdfDocument,
  pageState,
  scale,
  onRendered,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const currentRenderTaskRef = useRef<any>(null);

  useEffect(() => {
    let active = true;

    async function renderPage() {
      if (pageState.originalPageIndex === -1) {
        // Render a blank page
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Calculate visual dimensions under rotation
        const isRotated = pageState.rotationOffset % 180 !== 0;
        const width = isRotated ? pageState.height : pageState.width;
        const height = isRotated ? pageState.width : pageState.height;

        canvas.width = width * scale;
        canvas.height = height * scale;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        setLoading(false);
        if (onRendered) onRendered(canvas);
        return;
      }

      try {
        setLoading(true);
        const page = await pdfDocument.getPage(pageState.originalPageIndex + 1);
        
        if (!active) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Cancel any pending render task for this canvas
        if (currentRenderTaskRef.current) {
          currentRenderTaskRef.current.cancel();
        }

        // Compute final rotation: page base rotation + user added offset rotation
        const finalRotation = (pageState.originalRotation + pageState.rotationOffset) % 360;
        const viewport = page.getViewport({ scale, rotation: finalRotation });

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const renderContext = {
          canvasContext: ctx,
          viewport: viewport,
          canvas: canvas,
        };

        const renderTask = page.render(renderContext);
        currentRenderTaskRef.current = renderTask;

        await renderTask.promise;
        
        if (active) {
          setLoading(false);
          if (onRendered) onRendered(canvas);
        }
      } catch (err: any) {
        if (err.name !== 'RenderingCancelledException') {
          console.error('Error rendering page:', err);
        }
      }
    }

    renderPage();

    return () => {
      active = false;
      if (currentRenderTaskRef.current) {
        currentRenderTaskRef.current.cancel();
      }
    };
  }, [pdfDocument, pageState, scale]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} className={className} />
      {loading && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.05)',
          }}
        >
          <div className="spinner" style={{ width: '24px', height: '24px' }}></div>
        </div>
      )}
    </div>
  );
};
