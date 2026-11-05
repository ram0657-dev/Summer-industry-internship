import express, { Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Initialize GoogleGenAI server client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'Smart Canteen API' });
});

// Queue time estimator for students
app.post('/api/gemini/queue-estimate', async (req: Request, res: Response) => {
  try {
    const { pendingCount, preparingCount, totalItemsCount, timeSlot } = req.body;

    const prompt = `Analyze this college canteen state and estimate student pickup queue time:
- Pending orders in queue: ${pendingCount ?? 0}
- Currently preparing orders: ${preparingCount ?? 0}
- Total item volume in queue: ${totalItemsCount ?? 0}
- Current/Requested slot: ${timeSlot || 'immediate'}

Provide an accurate estimate in minutes, rush intensity ('Light', 'Moderate', 'Peak Rush'), and practical advice for the student.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        systemInstruction: 'You are an intelligent campus canteen queue management system. Respond with precise JSON estimates based on kitchen cooking capacity.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            estimatedMinutesMin: { type: Type.INTEGER, description: 'Minimum estimated wait time in minutes' },
            estimatedMinutesMax: { type: Type.INTEGER, description: 'Maximum estimated wait time in minutes' },
            rushLevel: { type: Type.STRING, description: 'Light, Moderate, or Peak Rush' },
            studentTip: { type: Type.STRING, description: 'Short actionable tip for the student' },
            queueSummary: { type: Type.STRING, description: 'One sentence explanation of the counter pace' },
          },
          required: ['estimatedMinutesMin', 'estimatedMinutesMax', 'rushLevel', 'studentTip', 'queueSummary'],
        },
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Queue estimate error:', error);
    // Provide a resilient calculated fallback
    const pending = Number(req.body?.pendingCount || 0);
    const minMins = Math.max(5, 5 + pending * 3);
    res.json({
      estimatedMinutesMin: minMins,
      estimatedMinutesMax: minMins + 7,
      rushLevel: pending > 6 ? 'Peak Rush' : pending > 2 ? 'Moderate' : 'Light',
      studentTip: 'Your order is queued in the kitchen. Keep your pickup token ready at the counter.',
      queueSummary: `${pending} orders ahead of you in prep queue.`,
    });
  }
});

// Kitchen demand and throughput forecasting for staff (High Thinking)
app.post('/api/gemini/kitchen-demand', async (req: Request, res: Response) => {
  try {
    const { activeOrders } = req.body;

    const prompt = `You are a kitchen operations consultant for a high-volume Indian college canteen.
Review active orders:
${JSON.stringify(activeOrders || [], null, 2)}

Provide strategic advice:
1. High-frequency dishes that should be prepared in batch immediately.
2. Bottlenecks (e.g., dosa griddle, frying station, coffee counter).
3. Recommended prep action plan for next 15-30 minutes.
4. Estimated total kitchen workload index (1-100).`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-argon',
      contents: prompt,
      config: {
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.HIGH,
        },
        systemInstruction: 'You are an expert chef and canteen operations manager. Provide clear operational guidance in JSON.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            workloadScore: { type: Type.INTEGER, description: 'Workload intensity 1 to 100' },
            bottleneckStation: { type: Type.STRING, description: 'The kitchen station under highest pressure' },
            priorityBatchDishes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Names of items that should be prepared concurrently',
            },
            prepAdvice: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Actionable steps for the staff',
            },
            summary: { type: Type.STRING, description: 'High-level kitchen status briefing' },
          },
          required: ['workloadScore', 'bottleneckStation', 'priorityBatchDishes', 'prepAdvice', 'summary'],
        },
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    res.json(parsed);
  } catch (error: any) {
    console.error('Kitchen demand error:', error);
    res.json({
      workloadScore: 45,
      bottleneckStation: 'Standard Counter',
      priorityBatchDishes: ['Fresh Dosa', 'Veg Fried Rice', 'Cold Coffee'],
      prepAdvice: [
        'Keep sambar and chutney heated in warmers for instant breakfast assembly.',
        'Prep sandwich fillings in advance to minimize counter assembly delay.',
        'Batch cold drinks orders together for rapid handoff.',
      ],
      summary: 'Moderate order volume. Kitchen pace is steady with normal turnaround.',
    });
  }
});

// Setup Vite or static serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Smart Canteen server running on http://0.0.0.0:${port}`);
  });
}

startServer();
