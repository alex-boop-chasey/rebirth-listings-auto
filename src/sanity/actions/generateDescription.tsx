/**
 * Sanity Studio document action: "Generate description".
 *
 * Shown on the listing document. On click it POSTs the document id to
 * /api/generate-description (same origin as the embedded Studio), receives a
 * Portable Text description, and patches the DRAFT's `description` field — no
 * confirm dialog (silent overwrite; Sanity document history is the undo path).
 * The dealer edits if they want, then publishes themselves. On error it toasts
 * the message and leaves the field untouched.
 *
 * All AI/config lives server-side in the endpoint; this action is a thin trigger.
 */
import { useCallback, useState } from 'react';
import { useDocumentOperation, type DocumentActionComponent } from 'sanity';
import { useToast } from '@sanity/ui';

export const generateDescriptionAction: DocumentActionComponent = (props) => {
  const { id, type, onComplete } = props;
  const { patch } = useDocumentOperation(id, type);
  const toast = useToast();
  const [generating, setGenerating] = useState(false);

  const handle = useCallback(async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/generate-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId: id }),
      });
      const data = (await res.json().catch(() => null)) as
        | { description?: unknown; error?: string }
        | null;

      if (!res.ok || !data || !Array.isArray(data.description)) {
        toast.push({
          status: 'error',
          title: 'Generate description',
          description: data?.error ?? `Request failed (${res.status}).`,
        });
        return;
      }

      // Patch the draft; it stays unpublished for the dealer to review + publish.
      patch.execute([{ set: { description: data.description } }]);
      toast.push({
        status: 'success',
        title: 'Description generated',
        description: 'Review it and publish when you’re happy.',
      });
      onComplete();
    } catch (err) {
      toast.push({
        status: 'error',
        title: 'Generate description',
        description: err instanceof Error ? err.message : 'Network error.',
      });
    } finally {
      setGenerating(false);
    }
  }, [id, patch, toast, onComplete]);

  return {
    label: generating ? 'Generating…' : 'Generate description',
    disabled: generating,
    onHandle: handle,
  };
};
