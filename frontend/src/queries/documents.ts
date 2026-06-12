import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  API_BASE,
  deleteDocument,
  listDocuments,
  uploadDocuments,
  type DocumentOut,
} from "../lib/api";

const DOCUMENTS_KEY = ["documents"] as const;

/** URL du fichier source original (servi par le backend), pour le viewer. */
export function getDocumentFileUrl(docId: string): string {
  return `${API_BASE}/api/documents/${docId}/file`;
}

export function useDocuments() {
  return useQuery<DocumentOut[]>({
    queryKey: DOCUMENTS_KEY,
    queryFn: listDocuments,
  });
}

export function useUploadDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (files: File[]) => uploadDocuments(files),
    onSuccess: () => qc.invalidateQueries({ queryKey: DOCUMENTS_KEY }),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: DOCUMENTS_KEY }),
  });
}
