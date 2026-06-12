import { pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Worker pdf.js servi par Vite depuis le paquet installé (PAS de CDN). En passant
// par `import.meta.url`, Vite émet le worker en asset et la version est forcément
// alignée sur celle de react-pdf → aucun avertissement « fake worker ».
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
