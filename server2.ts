import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import "dotenv/config";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
    throw new Error("CRITICAL: WEBHOOK_SECRET is missing");
}

const app = express();

// --- TYPES ---
type WebhookEvent = {
    id: string;
    type: string;
    data: {
        orderId: string;
        amount: number;
        email: string;
    }
}

type EventStatus = "pending" | "processing" | "processed" | "failed" | "dead";

type TrackedEvent = WebhookEvent & {
    status: EventStatus;
    attempts: number; // Counter for retries
};


// --- STATE ---
const eventQueue: WebhookEvent[] = [];
const deadLetterQueue: TrackedEvent[] = [];
// Using a Map for O(1) lookups to quickly prevent duplicate processing
const events = new Map<string, TrackedEvent>();


// --- MIDDLEWARES & SECURITY ---
// Necessary to preserve the exact payload string for HMAC validation
const captureRawBody = express.json({
    verify: (req: any, _res, buf) => {
        req.rawBody = buf.toString();
    }
});

function generateHmacSignature(payload: string): string {
    return crypto.createHmac("sha256", WEBHOOK_SECRET!)
        .update(payload)
        .digest("hex");
}

function requireValidSignature(req: any, res: Response, next: NextFunction) {
    const signature = req.header("x-webhook-signature");
    if (!signature) {
        return res.status(401).send("Missing signature");
    }

    const expectedSignature = generateHmacSignature(req.rawBody || "");
    if (signature !== expectedSignature) {
        return res.status(401).send("Invalid signature");
    }

    next();
}


// --- WORKER LOGIC ---
function processWebhook(event: WebhookEvent) {
    const tracked = events.get(event.id);
    if (!tracked) return;

    console.log(`[Worker] Start processing: ${event.id} (Attempt: ${tracked.attempts + 1})`);

    try {
        // Simulate Error
        // throw new Error("Feign failed DB connexion (test)");

        tracked.status = "processed";
        console.log(`[Worker] Finish processing: ${event.id}`);

    } catch (error) {
        tracked.attempts++;
        console.error(`[Worker] Failed processing ${event.id} - Attempt ${tracked.attempts}/3:`, error instanceof Error ? error.message : "Erreur inconnue");

        if (tracked.attempts < 3) {
            // Pattern de Retry
            tracked.status = "pending";
            eventQueue.push(event);
            console.log(`[Worker] Re-queued ${event.id} for retry.`);
        } else {
            tracked.status = "dead";
            // On isole l'événement dans la structure dédiée
            deadLetterQueue.push(tracked);

            console.log(`[Worker] Event ${event.id} routed to DLQ.`);
            console.log(`[DLQ] State (${deadLetterQueue.length} items):`);
            console.table(deadLetterQueue.map(e => ({
                id: e.id,
                status: e.status,
                attempts: e.attempts
            })));
        }
    }
}

function startQueueWorker() {
    // Polling the queue at regular intervals decouples HTTP ingestion from heavy background processing
    setInterval(() => {
        if (eventQueue.length === 0) return;

        const event = eventQueue.shift();
        if (event) {
            const tracked = events.get(event.id);
            if (tracked) tracked.status = "processing";

            processWebhook(event);
        }
    }, 2000);
}


// --- ROUTES ---
app.use(captureRawBody);

app.post("/webhook/payment", requireValidSignature, (req: Request, res: Response) => {
    const event = req.body as WebhookEvent;

    if (!event || !event.id) {
        return res.status(400).send("Bad Request: Missing ID");
    }

    // Idempotency check: prevent processing the same webhook twice if the provider retries
    if (events.has(event.id)) {
        console.log(`[Route] Idempotency hit: ${event.id} already known.`);
        return res.status(200).send("already processed");
    }

    events.set(event.id, { ...event, status: "pending", attempts: 0 })
    eventQueue.push(event);

    console.log(`[Route] Event ${event.id} queued. Queue size: ${eventQueue.length}`);
    res.status(200).send("ok");
});

app.get("/events", (_req: Request, res: Response) => {
    res.status(200).json(Array.from(events.values()));
});

// --- INIT ---
startQueueWorker();

app.listen(3000, () => {
    console.log("Server running on port 3000");
});