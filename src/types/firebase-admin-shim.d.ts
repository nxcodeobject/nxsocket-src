declare module "firebase-admin" {
  const admin: {
    apps: unknown[];
    initializeApp: (options: Record<string, unknown>) => unknown;
    credential: { cert: (serviceAccount: object) => unknown };
    firestore: () => unknown;
  };
  export default admin;
  export = admin;
}
