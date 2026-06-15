import * as mupdf from "mupdf";
console.log("AnnotationType keys:", Object.keys(mupdf.AnnotationType || {}));
console.log("All mupdf exports:", Object.keys(mupdf).filter(k => /Annot|Type/i.test(k)));
