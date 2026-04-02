"use client";

import { useEffect } from "react";
import { ApiReferenceReact } from "@scalar/api-reference-react";

/**
 * Renders the Scalar API reference UI inside a full-viewport-width container.
 *
 * CSS is injected dynamically via a <link> tag on mount and removed on unmount
 * so it doesn't bleed into the dark-themed pages when the user navigates away.
 * (A static `import "...style.css"` would stay in the global stylesheet for
 * the entire session, overwriting the site's bg-stone-950 background.)
 *
 * The wrapper div uses margin-left (not transform) for the full-bleed shift.
 * A CSS transform would create a new stacking context and trap Scalar's
 * position:fixed Test Request modal inside it, breaking its scrolling.
 *
 *   width: 100vw
 *   margin-left: calc((100% - 100vw) / 2)  ← aligns left edge with viewport
 *
 * Negative top/bottom margins cancel the py-8 padding from the parent <main>.
 */
export default function ScalarClient() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/scalar-styles.css";
    link.id = "scalar-styles";
    document.head.appendChild(link);

    return () => {
      document.getElementById("scalar-styles")?.remove();
    };
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        marginLeft: "calc((100% - 100vw) / 2)",
        marginTop: "-2rem",
        marginBottom: "-2rem",
      }}
    >
      <ApiReferenceReact
        configuration={{
          url: "/openapi.yaml",
          theme: "default",
          layout: "modern",
          // Always send test requests to the same origin the user is on.
          // This means both allaboard.dev and www.allaboard.dev work without
          // hitting cross-origin CORS restrictions.
          baseServerURL: window.location.origin,
          defaultHttpClient: {
            targetKey: "shell",
            clientKey: "curl",
          },
          agent: { disabled: true },
        }}
      />
    </div>
  );
}
