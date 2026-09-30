export const UNRECOVERABLE_STATUS_CODES = new Set([400, 403, 404, 409, 410]);

export const extractErrorStatus = (err: unknown): number | undefined => {
  return (
    (err as { status?: number; response?: { status?: number } })?.status ??
    (err as { status?: number; response?: { status?: number } })?.response
      ?.status
  );
};
