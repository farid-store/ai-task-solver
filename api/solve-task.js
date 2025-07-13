// api/solve-task.js
import { GoogleGenerativeAI } from '@google/generative-ai';
import formidable from 'formidable';
import fs from 'fs/promises';

// Fungsi helper untuk mengonversi buffer file ke format yang dapat diterima Gemini
function fileToGenerativePart(fileBuffer, mimeType) {
  return {
    inlineData: {
      data: fileBuffer.toString('base64'),
      mimeType
    },
  };
}

export const config = {
  api: {
    bodyParser: false, // Penting! Nonaktifkan bodyParser agar kita bisa memproses multipart/form-data secara manual
  },
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ message: 'Method Not Allowed' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return response.status(500).json({ message: 'GEMINI_API_KEY environment variable is not configured.' });
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // Gunakan model yang mendukung multimodal (vision) dan konteks panjang
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Atau 'gemini-1.5-flash-latest'

  try {
    const form = formidable({});
    const [fields, files] = await form.parse(request);

    if (!files.assignmentFile || files.assignmentFile.length === 0) {
      return response.status(400).json({ message: 'No assignment file uploaded.' });
    }

    const assignmentFile = files.assignmentFile[0];
    const fileBuffer = await fs.readFile(assignmentFile.filepath);
    const filePart = fileToGenerativePart(fileBuffer, assignmentFile.mimetype);

    const taskInstructions = fields.taskInstructions ? fields.taskInstructions[0] : '';
    const outputLanguage = fields.outputLanguage ? fields.outputLanguage[0] : 'en'; // Dapatkan bahasa output dari frontend

    if (!taskInstructions.trim()) {
        return response.status(400).json({ message: 'Task instructions cannot be empty.' });
    }

    // Tentukan bahasa untuk instruksi prompt ke AI
    const languagePrompt = outputLanguage === 'id' ? 
        "Berikan solusi/analisis dalam Bahasa Indonesia." : 
        "Provide the solution/analysis in English.";

    const parts = [
      filePart,
      { text: `I have uploaded a file. Please analyze its content and help me solve the following task based on its content:` },
      { text: `Task: "${taskInstructions}"` },
      { text: `Provide a detailed and complete solution or analysis based on the file. If the task is to summarize, provide a comprehensive summary. If it's to answer questions, provide clear answers. If it's to generate content (like an outline), provide the requested output. Format the solution as plain, readable text, suitable for direct display or download. Do not include any introductory or concluding remarks not directly related to the solution itself. Make sure the solution directly addresses the user's instructions. ${languagePrompt}` },
      { text: `Important: If the file content is not readable or relevant to the task, please state that clearly and briefly in the requested language instead of attempting a solution.` }
    ];
    
    // Safety settings (opsional, tapi disarankan)
    const generationConfig = {
      temperature: 0.7, // Kontrol kreativitas/randomness
      topK: 30,         // Batasi token yang dipertimbangkan
      topP: 0.9,        // Probabilitas kumulatif
    };

    const result = await model.generateContent({
        contents: [{ role: "user", parts: parts }],
        generationConfig: generationConfig,
    });

    const geminiResponse = result.response.text();
    console.log("Gemini Raw Solution:", geminiResponse);
    
    response.status(200).json({ solution: geminiResponse });

  } catch (error) {
    console.error('Error in solve-task API:', error);
    // Pastikan ini selalu mengirim JSON
    const errorMessage = request.headers['accept-language'] && request.headers['accept-language'].includes('id') ? 
        `Gagal memproses tugas. Detail kesalahan: ${error.message}` : 
        `Failed to process task. Error details: ${error.message}`;

    response.status(500).json({ message: errorMessage }); // INI YANG PENTING
  }
}
