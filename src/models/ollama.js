import { toSinglePrompt, strictFormat } from '../utils/text.js';

export class Ollama {
    static prefix = 'ollama';
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.params = params;
        this.url = url || 'http://127.0.0.1:11434';
        this.chat_endpoint = '/api/chat';
        this.embedding_endpoint = '/api/embeddings';
        this.vision_endpoint = 'api/generate';
    }

    async sendRequest(turns, systemMessage) {
        let model = this.model_name || 'sweaterdog/andy-4:micro-q8_0';
        let messages = strictFormat(turns);
        messages.unshift({ role: 'system', content: systemMessage });
        const maxAttempts = 5;
        let attempt = 0;
        let finalRes = null;

        while (attempt < maxAttempts) {
            attempt++;
            console.log(`Awaiting local response... (model: ${model}, attempt: ${attempt})`);
            let res = null;
            try {
                let apiResponse = await this.send(this.chat_endpoint, {
                    model: model,
                    messages: messages,
                    stream: false,
                    ...(this.params || {})
                });
                if (apiResponse) {
                    res = apiResponse['message']['content'];
                } else {
                    res = 'No response data.';
                }
            } catch (err) {
                if (err.message.toLowerCase().includes('context length') && turns.length > 1) {
                    console.log('Context length exceeded, trying again with shorter context.');
                    return await this.sendRequest(turns.slice(1), systemMessage);
                } else {
                    console.log(err);
                    res = 'My brain disconnected, try again.';
                }
            }

            const hasOpenTag = res.includes("<think>");
            const hasCloseTag = res.includes("</think>");

            if ((hasOpenTag && !hasCloseTag)) {
                console.warn("Partial <think> block detected. Re-generating...");
                if (attempt < maxAttempts) continue;
            }
            if (hasCloseTag && !hasOpenTag) {
                res = '<think>' + res;
            }
            if (hasOpenTag && hasCloseTag) {
                res = res.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            }
            finalRes = res;
            break;
        }

        if (finalRes == null) {
            console.warn("Could not get a valid response after max attempts.");
            finalRes = 'I thought too hard, sorry, try again.';
        }
        return finalRes;
    }

    async embed(text) {
        try {
            let model = this.model_name || 'nomic-embed-text';
            let body = { model: model, input: text };
            let res = await this.send(this.embedding_endpoint, body);
            return res['embedding'];
        }
        catch (err) {
            console.error('Failed to send  embedding request.');
            console.error(err);
        }
    }

    async send(endpoint, body) {
        const url = new URL(endpoint, this.url);
        let method = 'POST';
        let headers = new Headers();
        const request = new Request(url, { method, headers, body: JSON.stringify(body) });
        let data = null;
        try {
            const res = await fetch(request);
            if (res.ok) {
                data = await res.json();
            } else {
                throw new Error(`Ollama Status: ${res.status}`);
            }
        } catch (err) {
            console.error('Failed to send Ollama request.');
            console.error(err);
        }
        return data;
    }

        async sendVisionRequest(turns, imagePrompt, imageBuffer) {
            const model = this.model_name || 'llava'; // Default to llava for vision tasks
            const stop_seq = '***';
            // Get last 4 non-system messages
            const recentNonSystemMessages = turns
                .filter(msg => msg.role !== 'system')
                .slice(-4); // Take last 3 items
            const prompt = toSinglePrompt(recentNonSystemMessages, imagePrompt, stop_seq, model);
    
            // Retry logic for handling errors
            const maxAttempts = 5;
            let attempt = 0;
            let res = null;
    
            while (attempt < maxAttempts) {
                attempt++;
                console.log(`Awaiting vision response... (model: ${model}, attempt: ${attempt})`);
    
                try {
                    res = await this.send(this.vision_endpoint, {
                        model: model,
                        prompt: prompt,
                        images: [imageBuffer.toString('base64')], // Base64-encoded image
                        stream: false
                    });
    
                    if (res) {
                        const response = await res.response;
                        res = response;
                        break; // Exit loop if we got a valid response
                    } else {
                        res = 'No response data.';
                    }
                } catch (err) {
                    if (err.message.toLowerCase().includes('context length')) {
                        console.log('Context length exceeded');
                        // You might want to shorten the prompt here
                        imagePrompt = imagePrompt.substring(0, Math.floor(imagePrompt.length * 0.3));
                        console.log('Shortened prompt and retrying...');
                    } else {
                        console.log('Vision request error:', err);
                        res = 'My vision is blurry, try again.';
                        continue;
                    }
                }
            }
    
            if (!res) {
                console.warn("Could not get a valid response after max attempts.");
                res = 'I looked too hard, sorry, try again.';
            }
    
            return res;
        }
}
