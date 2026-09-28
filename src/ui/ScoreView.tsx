import { useEffect, useRef, useState } from 'react';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

/** Renders MusicXML with OpenSheetMusicDisplay, optionally only bars [from, to] (1-based indices). */
export function ScoreView({ xml, from, to, compact = false }: { xml: string; from?: number; to?: number; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const loadedXml = useRef<string | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    const run = async () => {
      try {
        if (!osmdRef.current) {
          // OSMD is large; load it only when a score is shown.
          const { OpenSheetMusicDisplay } = await import('opensheetmusicdisplay');
          if (cancelled) return;
          osmdRef.current = new OpenSheetMusicDisplay(ref.current!, {
            autoResize: true,
            backend: 'svg',
            drawTitle: !compact,
            drawComposer: !compact,
            drawCredits: !compact,
            drawingParameters: 'compacttight',
          });
        }
        const osmd = osmdRef.current;
        if (loadedXml.current !== xml) {
          await osmd.load(xml);
          loadedXml.current = xml;
        }
        if (cancelled) return;
        osmd.setOptions({ drawFromMeasureNumber: from ?? 1, drawUpToMeasureNumber: to ?? Number.MAX_SAFE_INTEGER });
        osmd.render();
        setError(undefined);
      } catch (e) {
        setError(`Could not render score: ${(e as Error).message}`);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [xml, from, to]);

  return (
    <div>
      {error && <div className="error">{error}</div>}
      <div ref={ref} className="score-view" />
    </div>
  );
}
