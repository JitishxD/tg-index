import { TelegramClient, networkMiddlewares, type RpcCallMiddleware } from "@mtcute/bun";
import { config } from "../config";

/**
 * mtcute downloads call upload.getFile with maxRetryCount=Infinity, so a DC answering
 * "-503 Timeout" is retried forever. Cap it so the error reaches our stream/thumb code,
 * which retries with a fresh file reference or fails the request cleanly.
 */
const FILE_RETRIES = 4;
const capFileRetries: RpcCallMiddleware = (ctx, next) => {
  const p = ctx.params;
  if (ctx.request._ === "upload.getFile" && (p?.maxRetryCount ?? Infinity) > FILE_RETRIES) return next({ ...ctx, params: { ...p, maxRetryCount: FILE_RETRIES } });
  return next(ctx);
};

export const tg = new TelegramClient({
  apiId: config.apiId,
  apiHash: config.apiHash,
  storage: `${config.dataDir}/session`, // bun:sqlite storage, persists auth + peer access hashes
  updates: { catchUp: true },
  network: {
    middlewares: [
      capFileRetries,
      ...networkMiddlewares.basic({
        floodWaiter: { maxWait: config.floodMaxWaitSec * 1000, maxRetries: 10 },
        internalErrors: { waitTime: 2 },
      }),
    ],
  },
});
