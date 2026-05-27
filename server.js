import express from 'express';
import crypto from 'crypto';

const app = express();
const port = process.env.PORT || 3001;

// IMPORTANT: To verify the signature, we absolutely need the raw, unparsed text of the request.
// If we use the parsed JSON object directly, we lose the exact formatting (spaces, newlines) 
// and the generated signature will mismatch the one sent by the provider.
app.use(express.json({
    verify: (req, res, buf) => {
        // Save the original Buffer as a UTF-8 string on the request object for later use
        req.rawBody = buf.toString('utf8');
    }
}));

app.get('/', (req, res) => {
    res.json({ message: 'Minimalist Node.js backend is running!' });
});

app.post('/echo', (req, res) => {
    res.json({ received: req.body });
});

const WEBHOOK_SECRET = 'whsec_student_test_secret_123';

app.post('/webhook', (req, res) => {
    try {
        const signatureHeader = req.headers['stripe-signature'];
        console.log("DEBUG - Received header:", signatureHeader);

        if (!signatureHeader) {
            console.warn('Webhook ignored: Missing Stripe-Signature header.');
            return res.status(400).json({ status: 'error', message: 'Missing signature' });
        }

        // 1. Extract the timestamp (t) and the signature (v1) from the header
        const parts = signatureHeader.split(',').map(p => p.trim());
        let timestamp = '';
        let signature = '';

        for (const part of parts) {
            if (part.startsWith('t=')) timestamp = part.substring(2);
            if (part.startsWith('v1=')) signature = part.substring(3);
        }

        if (!timestamp || !signature) {
            console.error("DEBUG - Extraction failed. Timestamp:", timestamp, "Signature:", signature);
            return res.status(400).json({ status: 'error', message: 'Invalid signature format' });
        }

        // 2. Reconstruct the string to sign: "timestamp.payload"
        // We strictly use req.rawBody here to match exactly what the client sent over the wire
        const payloadToSign = `${timestamp}.${req.rawBody}`;

        // 3. Calculate our own signature using our shared secret
        const expectedSignature = crypto
            .createHmac('sha256', WEBHOOK_SECRET)
            .update(payloadToSign)
            .digest('hex');

        // 4. Compare our calculated signature with the one received in the header
        // Note: In production, ALWAYS use crypto.timingSafeEqual to prevent timing attacks
        if (expectedSignature !== signature) {
            console.error('Invalid signature! Expected:', expectedSignature, 'Received:', signature);
            return res.status(401).json({ status: 'error', message: 'Invalid signature' });
        }

        // 5. Process the webhook if the signature is valid
        console.log('✅ Webhook successfully validated! Payload:', JSON.stringify(req.body, null, 2));

        // Acknowledge receipt to the webhook provider so they don't retry
        res.status(200).json({ status: 'ok', received: req.body });

    } catch (error) {
        console.error('Error processing the webhook:', error);
        // Send a 500 error so the provider knows something went wrong on our end and retries later
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// ==========================================
// 1. QUEUE SYSTEM (IN-MEMORY)
// ==========================================

// This array acts as our queue. New items are added to the end (push),
// and the worker will take them from the beginning (shift).
const jobQueue = [];

// This is our new route that demonstrates the queue pattern.
// "async" is a good naming convention for endpoints that queue work.
app.post('/webhook-async', (req, res) => {
    try {
        const signatureHeader = req.headers['stripe-signature'];

        if (!signatureHeader) {
            return res.status(400).json({ status: 'error', message: 'Missing signature' });
        }

        const parts = signatureHeader.split(',').map(p => p.trim());
        let timestamp = '', signature = '';

        for (const part of parts) {
            if (part.startsWith('t=')) timestamp = part.substring(2);
            if (part.startsWith('v1=')) signature = part.substring(3);
        }

        if (!timestamp || !signature) {
            return res.status(400).json({ status: 'error', message: 'Invalid signature format' });
        }

        const payloadToSign = `${timestamp}.${req.rawBody}`;
        const expectedSignature = crypto
            .createHmac('sha256', WEBHOOK_SECRET)
            .update(payloadToSign)
            .digest('hex');

        if (expectedSignature !== signature) {
            return res.status(401).json({ status: 'error', message: 'Invalid signature' });
        }

        // --- ENQUEUE PHASE ---
        console.log(`\n--- NEW WEBHOOK EVENT ---`);
        console.log(`[1] Payload reçu et validé.`);

        // Wrap the data in a "job" object
        const job = {
            id: crypto.randomUUID(), // Unique identifier for tracking
            addedAt: new Date().toISOString(),
            payload: req.body // The actual data to process later
        };

        // Add to the end of our queue array
        jobQueue.push(job);
        console.log(`[2] Mise en queue du job ${job.id} (Taille de la queue: ${jobQueue.length})`);

        // IMMEDIATELY return a 200 OK. 
        // We don't wait for the job to be finished! Stripe requires a 2xx response quickly.
        console.log(`[3] Retour 200 à stripe immédiat pour fermer la connexion HTTP.`);
        res.status(200).json({ status: 'ok', jobId: job.id });

    } catch (error) {
        console.error('Error queuing the webhook:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
});

// ==========================================
// 2. THE ASYNC WORKER (RECURSIVE LOOP)
// ==========================================

// Utility function to pause execution (sleep) for a given amount of time.
// This uses a Promise that resolves after 'ms' milliseconds.
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// The core of Idea B: A self-calling asynchronous function.
async function processQueue() {
    // 1. CHECK: Is there anything in the queue?
    if (jobQueue.length > 0) {
        // Take the FIRST element from the array (First In, First Out - FIFO)
        const job = jobQueue.shift();

        console.log(`[4] ⚙️ WORKER: Processing du paiement pour le job ${job.id}...`);
        // console.log(`[⚙️ WORKER] Payload:`, job.payload);

        try {
            // Simulate a time-consuming task (e.g., generating an invoice, sending an email)
            // We use 'await' to guarantee we don't start the next job until this one finishes.
            await sleep(2000);

            console.log(`[5] ✅ WORKER: Processing terminé pour le job ${job.id}`);
        } catch (err) {
            // If a job fails, we log it, but the worker KEEPS RUNNING for the next jobs.
            console.error(`[❌ WORKER] Job ${job.id} failed:`, err);
        }

        // Immediately proceed to the next cycle in the queue.
        // We use setImmediate to yield to the Event Loop, preventing "Call stack exceeded" errors.
        setImmediate(processQueue);
    } else {
        // 2. IDLE: The queue is empty.
        // Wait for 500ms before checking again so we don't max out the CPU.
        await sleep(500);

        // Loop back and check again
        setImmediate(processQueue);
    }
}

// Start the worker loop in the background!
// It will run independently of incoming HTTP requests.
processQueue();

app.listen(port, () => {
    console.log(`Server started on http://localhost:${port}`);
});
