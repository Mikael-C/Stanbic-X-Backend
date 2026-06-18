/**
 * Initialize Express application.
 */
declare const app: import("express-serve-static-core").Express;
declare const httpServer: import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>;
/**
 * Initialize WebSocket server.
 */
declare const io: import("socket.io").Server<import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, any>;
export { app, httpServer, io };
//# sourceMappingURL=index.d.ts.map