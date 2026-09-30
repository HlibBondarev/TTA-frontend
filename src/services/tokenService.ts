let tokenGetter: (() => Promise<string | null>) | null = null;

export const setTokenGetter = (getter: () => Promise<string | null>): void => {
  tokenGetter = getter;
};

export const getAuthToken = async (): Promise<string | null> => {
  if (!tokenGetter) return null;
  try {
    return await tokenGetter();
  } catch (error) {
    console.error("Failed to retrieve Auth0 access token:", error);
    return null;
  }
};
