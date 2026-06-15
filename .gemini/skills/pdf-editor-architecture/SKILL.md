---
name: pdf-editor-architecture
description: Explains the core architecture, functional flow, and critical files of the PDF Editor project.
---

# PDF Editor Architecture & Functional Flow

This skill provides an overview of the technical architecture and logic flow behind the PDF Editor repository. Use this knowledge whenever you need to modify, debug, or extend the core PDF editing capabilities.

## High-Level Architecture

The PDF Editor is a React + Vite application that relies on a dual-engine approach to achieve true, in-place PDF text editing:
1. **MuPDF (`mupdf`):** Used for deep, physical redaction of original text blocks to ensure no underlying artifact remains.
2. **PDF-lib (`pdf-lib`):** Used for assembling the final document, drawing the new text, drawing shapes/annotations, and managing the page sequence.

To identify what text can be edited, the frontend uses **PDF.js (`pdfjs-dist`)** to render the PDF to a canvas and extract precise visual coordinates for all text items.

## Functional Flow

The lifecycle of opening, editing, and saving a PDF follows these critical steps:

### 1. Document Loading and Rendering
- **`src/utils/pdf-manager.ts` (`getPdfPagesInfo`)**: Extracts page dimensions and metadata using PDF.js.
- **`src/utils/pdf-text-extractor.ts` (`extractPageTextBlocks`)**: Parses the PDF.js `TextContent` and normalizes the coordinates of every word/phrase. It groups lines together intelligently using geometric heuristics to form `PdfTextBlock` objects.

### 2. The User Interface Overlay
- **`src/components/TextEditOverlay.tsx`**: Maps the extracted `PdfTextBlock` objects directly onto the frontend React canvas. It renders `contenteditable` divs exactly over the original text. When a user modifies the text, an annotation of type `text-edit` is created holding both the original string and the new string.

### 3. Compilation & Save Process
When the user clicks "Save" or "Export", the `compilePdf` function inside `src/utils/pdf-manager.ts` triggers a two-pass compilation sequence:

**First Pass: MuPDF Redaction**
- Finds all `text-edit` annotations.
- Converts normalized visual coordinates to MuPDF bounds.
- Applies a physical redaction (`createAnnotation("Redact")` followed by `applyRedactions(false)`) to permanently destroy the old text at the binary level.

**Second Pass: PDF-lib Reconstruction**
- The redacted binary is loaded into a new `PDFDocument`.
- Pages are copied over in the correct order/rotation.
- The new text is typeset and drawn onto the page.

### 4. Advanced Text Layout & Reflow
If a user replaces a short word with a long paragraph, the text must wrap and push surrounding content down. This is handled by `src/utils/layout-engine.ts`:
- **`AdvancedTextLayout`**: Implements the Knuth-Plass line-breaking algorithm (via `tex-linebreak2`) to calculate aesthetically optimal text wrapping within the bounding box.
- **`ContentStreamCoordinator`**: Parses the raw PDF AST (Abstract Syntax Tree) to intercept `Tm`, `Td`, and `TD` text matrix operators. It injects a delta shift (`deltaY`) to mathematically push all subsequent content streams down the page to prevent text overlap.

## Key Files to Remember

- `src/utils/pdf-manager.ts`: The central orchestrator for PDF compilation.
- `src/utils/layout-engine.ts`: The hardest part of the codebase; contains AST manipulation and Knuth-Plass layout.
- `src/utils/pdf-text-extractor.ts`: Geometric mapping of PDF space to Screen space.
- `src/components/TextEditOverlay.tsx`: The React component responsible for the WYSIWYG editing experience.
