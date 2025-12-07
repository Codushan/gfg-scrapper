// Conditional imports for serverless usage vs local usage
let chromium = null;
let puppeteerCore = null;
let puppeteer = null;

if (process.env.VERCEL) {
    try {
        chromium = require('@sparticuz/chromium');
        puppeteerCore = require('puppeteer-core');
    } catch (e) {
        // Ignore if missing locally
    }
} else {
    try {
        puppeteer = require('puppeteer');
    } catch (e) {
        // Ignore if missing
    }
}

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { username } = req.query;

    if (!username) {
        return res.status(400).json({ error: 'Please provide a username.' });
    }

    const url = `https://www.geeksforgeeks.org/profile/${username}?tab=activity`;
    let browser = null;

    try {
        if (process.env.VERCEL) {
            browser = await puppeteerCore.launch({
                args: chromium.args,
                defaultViewport: chromium.defaultViewport,
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
                ignoreHTTPSErrors: true,
            });
        } else {
            browser = await puppeteer.launch({
                headless: "new",
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
        }

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Auto-scroll logic
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                var totalHeight = 0;
                var distance = 100;
                var timer = setInterval(() => {
                    var scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;

                    if (totalHeight >= scrollHeight - window.innerHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });

        // Wait for content settlement
        await new Promise(r => setTimeout(r, 2000));

        try {
            await page.waitForFunction(() => document.body.innerText.includes('Problems Solved'), { timeout: 10000 });
        } catch (e) {
            // Proceed even if timeout
        }

        // Scraping logic
        const stats = await page.evaluate(() => {
            const data = {
                total_problems_solved: 0,
                total_score: 0,
                School: 0,
                Basic: 0,
                Easy: 0,
                Medium: 0,
                Hard: 0,
                pod_solved_longest_streak: 0
            };

            const extractNumber = (text) => {
                const match = text.match(/(\d+)/);
                return match ? parseInt(match[1], 10) : 0;
            };

            const allElements = Array.from(document.querySelectorAll('*'));

            allElements.forEach(el => {
                if (el.children.length > 0 && el.innerText && el.innerText.length > 100) return;

                const text = el.innerText || el.textContent;
                if (!text) return;
                const trimmed = text.trim();

                if (trimmed === 'Coding Score' || trimmed.includes('Coding Score')) {
                    const parent = el.parentElement;
                    if (parent) {
                        const parentText = parent.innerText;
                        const num = extractNumber(parentText.replace('Coding Score', ''));
                        if (num > data.total_score) data.total_score = num;
                    }
                }

                if (trimmed === 'Problems Solved') {
                    const parent = el.parentElement;
                    if (parent) {
                        const siblings = Array.from(parent.children);
                        siblings.forEach(sib => {
                            if (sib !== el) {
                                const num = extractNumber(sib.innerText);
                                if (num > 0 && num > data.total_problems_solved) {
                                    data.total_problems_solved = num;
                                }
                            }
                        });
                        const num = extractNumber(parent.innerText.replace('Problems Solved', ''));
                        if (num > data.total_problems_solved) data.total_problems_solved = num;
                    }
                }

                if (trimmed.includes('Longest Streak')) {
                    const match = trimmed.match(/Longest Streak\s*:\s*(\d+)/i);
                    if (match) {
                        data.pod_solved_longest_streak = parseInt(match[1], 10);
                    } else {
                        const parent = el.parentElement;
                        if (parent) {
                            const num = extractNumber(parent.innerText.replace('Longest Streak', ''));
                            data.pod_solved_longest_streak = num;
                        }
                    }
                }
            });

            const difficulties = ['School', 'Basic', 'Easy', 'Medium', 'Hard'];
            const allDivs = Array.from(document.querySelectorAll('div'));

            difficulties.forEach(diff => {
                for (const div of allDivs) {
                    const text = div.innerText ? div.innerText.trim() : '';
                    if (!text) continue;
                    const regex = new RegExp(`^${diff}\\s*\\(\\s*(\\d+)\\s*\\)$`, 'i');
                    const match = text.match(regex);
                    if (match) {
                        data[diff] = parseInt(match[1], 10);
                        break;
                    }
                }
            });

            return data;
        });

        res.status(200).json(stats);

    } catch (error) {
        console.error('Error scraping profile:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
};

// Self-execution logic for local testing
if (require.main === module) {
    const http = require('http');
    const url = require('url');
    const PORT = 3000;

    const server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url, true);
        const query = parsedUrl.query;

        if (parsedUrl.pathname === '/favicon.ico') {
            res.writeHead(204);
            res.end();
            return;
        }

        console.log(`[Request] ${req.method} ${req.url}`);

        const mockReq = {
            query: query,
            method: req.method
        };

        const mockRes = {
            status: (code) => {
                res.statusCode = code;
                return mockRes;
            },
            json: (data) => {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(data, null, 2));
                return mockRes;
            },
            send: (data) => {
                res.end(data);
                return mockRes;
            }
        };

        try {
            await module.exports(mockReq, mockRes);
        } catch (error) {
            console.error('Handler error:', error);
            if (!res.writableEnded) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: error.message }));
            }
        }
    });

    server.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
        console.log(`Try it: http://localhost:${PORT}/api?username=chandrabhushq6z0`);
    });
}
