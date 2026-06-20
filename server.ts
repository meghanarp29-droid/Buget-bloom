import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

let aiInstance: GoogleGenAI | null = null;
function getAIInstance(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required on the server to scan receipts.");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Handle larger payloads for raw images
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // API Route: Scan Receipt
  app.post("/api/scan-receipt", async (req: express.Request, res: express.Response) => {
    try {
      const { image } = req.body;
      if (!image) {
        return res.status(400).json({ error: "No image data provided" });
      }

      // Match base64 and mime type structure
      let mimeType = "image/jpeg";
      let base64Data = image;

      const match = image.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Data = match[2];
      }

      const ai = getAIInstance();
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          "Analyze this payment receipt image. Extract the business/merchant/store name, total amount spent, transaction date, and choose one matching general category from the permitted list. Return intelligent fallbacks if any fields are unreadable.",
          { inlineData: { data: base64Data, mimeType: mimeType } }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              description: {
                type: Type.STRING,
                description: "Short business, store, or merchant name (e.g. Starbucks, Walmart, Exxon, Uber)"
              },
              amount: {
                type: Type.NUMBER,
                description: "Sum total amount printed on the receipt. If unreadable, return 0.00"
              },
              date: {
                type: Type.STRING,
                description: "Exact transaction date in YYYY-MM-DD format"
              },
              category: {
                type: Type.STRING,
                description: "Category of expense. Must be exactly one of the following: Cafe & Restaurants, Entertainment, Food & Groceries, Health & Beauty, Traveling, Investments, Other"
              },
              notes: {
                type: Type.STRING,
                description: "Store address, list of items, split info, or other relevant metadata"
              }
            },
            required: ["description", "amount", "date", "category"]
          }
        }
      });

      const text = response.text;
      if (!text) {
        throw new Error("Empty response from Gemini AI Model");
      }

      const result = JSON.parse(text);
      res.json({ success: true, data: result });
    } catch (err: any) {
      console.error("Error processing receipt in Gemini API endpoint:", err);
      res.status(500).json({ error: err.message || "Failed to process receipt image" });
    }
  });

  // API Route: Budget insights and next month recommendations
  app.post("/api/budget-insights", async (req: express.Request, res: express.Response) => {
    try {
      const { transactions, budgets } = req.body;
      if (!transactions || !Array.isArray(transactions)) {
        return res.status(400).json({ error: "Missing or invalid transactions payload" });
      }

      const ai = getAIInstance();
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          `Analyze these spending transactions and existing budgets to provide comprehensive budgeting guidelines.
           Transactions: ${JSON.stringify(transactions)}
           Current Budgets: ${JSON.stringify(budgets)}

           Suggest next month's optimized category-by-category budget recommendations based on recent spending patterns. Please analyze real-time outflow, trends, and outline saving tips.`
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              generalSummary: {
                type: Type.STRING,
                description: "Deep executive summary assessing previous consumption habits, overspending risks, and overall health suggestions."
              },
              totalSuggestedLimit: {
                type: Type.NUMBER,
                description: "Cumulative suggested budget ceiling limit recommendations across categories."
              },
              categoryInsights: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: {
                      type: Type.STRING,
                      description: "The name of the transaction category (e.g. Food, Shopping, Bills, Travel, Rent, Health, Education, Entertainment, Other)."
                    },
                    suggestedLimit: {
                      type: Type.NUMBER,
                      description: "Ideal budget threshold limit value proposed for the next period."
                    },
                    reason: {
                      type: Type.STRING,
                      description: "Granular rationale explaining why this amount is suggested, highlighting historical spending and savings potential."
                    },
                    historicalSpent: {
                      type: Type.NUMBER,
                      description: "The sum spent in this category according to supplied transactions."
                    },
                    trend: {
                      type: Type.STRING,
                      description: "Direct description of consumption direction: 'up', 'down', or 'stable'."
                    }
                  },
                  required: ["category", "suggestedLimit", "reason", "historicalSpent", "trend"]
                }
              },
              savingTips: {
                type: Type.ARRAY,
                items: {
                  type: Type.STRING
                },
                description: "List of actionable specific strategy recommendations to decrease monthly outflow."
              }
            },
            required: ["generalSummary", "totalSuggestedLimit", "categoryInsights", "savingTips"]
          }
        }
      });

      const text = response.text;
      if (!text) {
        throw new Error("Empty response from Gemini AI Model for budget insights");
      }

      const result = JSON.parse(text);
      res.json({ success: true, data: result });
    } catch (err: any) {
      console.error("Error processing budget insights in Gemini API endpoint:", err);
      res.status(500).json({ error: err.message || "Failed to generate budget insights" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
