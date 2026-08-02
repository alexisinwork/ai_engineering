import ollama from "ollama";
import express from "express";

const app = express();
const port = 3000;

app.get('/', async (req, res) => {
    const question = req.query.question;
    if (!question) {
        res.status(200).send("Ask something via the `?question=` parameter");  
    } else {
        // Express 4 does not catch rejections from async handlers, so without this
        // a failure here (ollama not running, model not pulled) leaves the request
        // hanging until the client gives up.
        try {
            const response = await ollama.chat({
                model: 'mistral',
                messages: [{ role: 'user', content: question }],
            });
            res.status(200).send(response.message.content);
        } catch (error) {
            console.error("Ollama request failed:", error.message);
            res.status(500).send(`Ollama request failed: ${error.message}`);
        }
    }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

