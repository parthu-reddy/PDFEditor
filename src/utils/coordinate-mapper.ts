/**
 * Coordinate Mapper Utility
 * 
 * Standardizes coordinate space translations between screen space and PDF point space.
 * 
 * Definitions:
 * - Visual relative coordinates: (x, y) where 0 <= x, y <= 1, representing the percentage
 *   offset from the visual top-left corner of the page as displayed to the user.
 * - PDF Point coordinates: Coordinates in PDF space where 1 inch = 72 points, and the origin (0,0)
 *   is at the bottom-left corner of the unrotated PDF page.
 */

export interface VisualBounds {
  x: number;      // 0 to 1 relative visual X
  y: number;      // 0 to 1 relative visual Y
  width: number;  // 0 to 1 relative visual width
  height: number; // 0 to 1 relative visual height
}

export interface PdfDrawingCoordinates {
  x: number;        // X coordinate in PDF points
  y: number;        // Y coordinate in PDF points
  width: number;    // Width in PDF points
  height: number;   // Height in PDF points
  rotateDegrees: number; // Rotation to apply when drawing in pdf-lib (degrees, counter-clockwise)
}

/**
 * Maps a single visual relative point (x, y) to a PDF point coordinate.
 */
export function mapVisualPointToPdfPoint(
  x: number,
  y: number,
  pdfWidth: number,
  pdfHeight: number,
  rotation: number
): { x: number; y: number } {
  // Normalize rotation to 0, 90, 180, 270
  const r = (rotation % 360 + 360) % 360;

  switch (r) {
    case 90:
      // Page is rotated 90 degrees clockwise.
      // Visual top-left is PDF (0, 0). Visual bottom-right is PDF (pdfWidth, pdfHeight).
      return {
        x: y * pdfWidth,
        y: x * pdfHeight,
      };
    case 180:
      // Page is rotated 180 degrees.
      // Visual top-left is PDF (pdfWidth, pdfHeight).
      return {
        x: (1 - x) * pdfWidth,
        y: y * pdfHeight, // In 180 degree rotation, visual Y goes down, PDF Y goes up from bottom
      };
    case 270:
      // Page is rotated 270 degrees clockwise (90 degrees counter-clockwise).
      return {
        x: (1 - y) * pdfWidth,
        y: (1 - x) * pdfHeight,
      };
    case 0:
    default:
      // Standard page. Visual top-left is PDF (0, pdfHeight)
      return {
        x: x * pdfWidth,
        y: (1 - y) * pdfHeight,
      };
  }
}

/**
 * Maps a visual relative bounding box to PDF drawing coordinates.
 * This takes into account the text box baseline start and direction
 * for pdf-lib drawing operations.
 */
export function mapVisualBoundsToPdfDrawing(
  bounds: VisualBounds,
  pdfWidth: number,
  pdfHeight: number,
  rotation: number,
  isText: boolean = false
): PdfDrawingCoordinates {
  const r = (rotation % 360 + 360) % 360;
  const { x, y, width, height } = bounds;

  const wPoints = width * (r === 90 || r === 270 ? pdfHeight : pdfWidth);
  const hPoints = height * (r === 90 || r === 270 ? pdfWidth : pdfHeight);

  if (isText) {
    // For text, the drawing origin (bottom-left) and orientation must be adjusted
    // so that text reads upright on screen and flows visually to the right.
    switch (r) {
      case 90:
        // 90 deg clockwise rotation.
        // PDF rotation = 90 deg counter-clockwise (to cancel out).
        // Drawing origin is visual bottom-left of the bounding box.
        return {
          x: (y + height) * pdfWidth,
          y: x * pdfHeight,
          width: wPoints,
          height: hPoints,
          rotateDegrees: 90,
        };
      case 180:
        // 180 deg rotation.
        // PDF rotation = 180 deg.
        // Drawing origin is visual bottom-right of the bounding box.
        return {
          x: (1 - (x + width)) * pdfWidth,
          y: (y + height) * pdfHeight,
          width: wPoints,
          height: hPoints,
          rotateDegrees: 180,
        };
      case 270:
        // 270 deg clockwise rotation.
        // PDF rotation = 270 deg (or -90).
        // Drawing origin is visual top-right of the bounding box.
        return {
          x: (1 - y) * pdfWidth,
          y: (1 - (x + width)) * pdfHeight,
          width: wPoints,
          height: hPoints,
          rotateDegrees: 270,
        };
      case 0:
      default:
        // Standard page.
        // PDF rotation = 0.
        // Drawing origin is visual bottom-left of the bounding box.
        return {
          x: x * pdfWidth,
          y: (1 - y - height) * pdfHeight,
          width: wPoints,
          height: hPoints,
          rotateDegrees: 0,
        };
    }
  } else {
    // For non-text shapes (like rectangles, images), we do not need to rotate the drawing boundary
    // if we just draw them aligned with the rotated page's coordinate system.
    // pdf-lib's drawRectangle / drawImage will draw relative to the page's coordinate system.
    // However, we must specify the coordinate of the bottom-left corner of the shape
    // in unrotated PDF coordinate space.
    switch (r) {
      case 90:
        return {
          x: y * pdfWidth,
          y: x * pdfHeight,
          width: hPoints, // Swap width/height because page coordinate system is rotated
          height: wPoints,
          rotateDegrees: 90,
        };
      case 180:
        return {
          x: (1 - x - width) * pdfWidth,
          y: y * pdfHeight,
          width: wPoints,
          height: hPoints,
          rotateDegrees: 180,
        };
      case 270:
        return {
          x: (1 - y - height) * pdfWidth,
          y: (1 - x - width) * pdfHeight,
          width: hPoints,
          height: wPoints,
          rotateDegrees: 270,
        };
      case 0:
      default:
        return {
          x: x * pdfWidth,
          y: (1 - y - height) * pdfHeight,
          width: wPoints,
          height: hPoints,
          rotateDegrees: 0,
        };
    }
  }
}
