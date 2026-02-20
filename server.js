const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require('body-parser');
const session = require('express-session');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'teams.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'competition-secret-key';

// ============================================
// Configuration Constants
// ============================================
const PRESENTER_WEIGHT = 0.35;
const SCI_WEIGHT = 2.0;
const OPP_WEIGHT = 2.0;
const REV_WEIGHT = 1.0;
const LENIENCY_MIN = 0.6;  // Tighter bounds
const LENIENCY_MAX = 1.5;
const LENIENCY_DAMPING = 1.0; // 50% correction only

const GRADE_MAP = {
    "2": 2.0, "3-": 5.0, "3": 9.0, "3+": 14.0, "4-": 20.0,
    "4": 27.0, "4+": 34.0, "5-": 42.0, "5": 51.0, "5+": 60.0
};

// Ensure directories exist
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ 
        teams: {}, 
        sections: {}, 
        leaderboard: [] 
    }, null, 2));
}

// Middleware
const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,  // Railway handles SSL proxy
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    },
    proxy: true
});

app.use(sessionMiddleware);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// Data Functions
// ============================================
function loadData() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(data);
        if (!parsed.sections) parsed.sections = {};
        return parsed;
    } catch (error) {
        console.error('Error loading data:', error);
        return { teams: {}, sections: {}, leaderboard: [] };
    }
}

function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

// ============================================
// LASS JavaScript Fallback
// ============================================
function parseGradeString(gradesStr) {
    if (!gradesStr) return [];
    const grades = gradesStr.trim().split(/\s+/);
    return grades.map(g => GRADE_MAP[g] || 0).filter(s => s > 0);
}

function getTrimmedAverage(scores, leniency) {
    if (!scores || scores.length === 0) return 0;
    leniency = leniency || 1.0;
    
    // Copy and sort
    const sorted = [...scores].sort((a, b) => a - b);
    
    // Trim if 3 or more scores
    if (sorted.length >= 3) {
        sorted.shift(); // Remove min
        sorted.pop();   // Remove max
    }
    
    // Calculate average
    const sum = sorted.reduce((a, b) => a + b, 0);
    const avg = sorted.length > 0 ? sum / sorted.length : 0;
    
    // Apply leniency adjustment
    return avg / leniency;
}

function fallbackCalculation(teams, sections) {
    const teamsArray = Object.values(teams);
    if (teamsArray.length === 0) return [];
    
    // Step 1: Group by section and collect all scores
    const sectionGroups = {};
    
    teamsArray.forEach(team => {
        const sectionId = team.section || 'default';
        if (!sectionGroups[sectionId]) {
            sectionGroups[sectionId] = {
                sectionId: sectionId,
                sectionName: (sections[sectionId] && sections[sectionId].name) ? sections[sectionId].name : sectionId,
                teams: [],
                allScores: [],
                meanRaw: 0,
                leniency: 1.0
            };
        }
        
        const grades = team.grades || [];
        
        grades.forEach(g => {
            const scores = parseGradeString(g.grade);
            scores.forEach(s => sectionGroups[sectionId].allScores.push(s));
        });
        
        sectionGroups[sectionId].teams.push({
            id: team.id,
            name: team.name,
            nationality: team.nationality,
            section: team.section,
            grades: grades,
            parsedGrades: grades.map(g => ({
                role: g.task,
                scores: parseGradeString(g.grade),
                rawStr: g.grade
            }))
        });
    });
    
    // Step 2: Calculate section means
    const sectionKeys = Object.keys(sectionGroups);
    
    sectionKeys.forEach(key => {
        const section = sectionGroups[key];
        if (section.allScores.length > 0) {
            const sum = section.allScores.reduce((a, b) => a + b, 0);
            section.meanRaw = sum / section.allScores.length;
        }
    });
    
    // Step 3: Calculate global mean
    let globalSum = 0;
    let globalCount = 0;
    
    sectionKeys.forEach(key => {
        const section = sectionGroups[key];
        section.allScores.forEach(s => {
            globalSum += s;
            globalCount++;
        });
    });
    
    const globalMean = globalCount > 0 ? globalSum / globalCount : 27.0;
    
    console.log('Global mean raw score:', globalMean);
    
    // Step 4: Calculate leniency with DAMPING
    sectionKeys.forEach(key => {
        const section = sectionGroups[key];
        
        if (globalMean > 0 && section.meanRaw > 0) {
            const rawRatio = section.meanRaw / globalMean;
            // DAMPING: Only apply 50% of the correction
            section.leniency = 1.0 + (rawRatio - 1.0) * LENIENCY_DAMPING;
        } else {
            section.leniency = 1.0;
        }
        
        // Clamp leniency
        section.leniency = Math.max(LENIENCY_MIN, Math.min(LENIENCY_MAX, section.leniency));
        
        console.log(`Section ${section.sectionName}: Mean=${section.meanRaw.toFixed(2)}, Leniency=${section.leniency.toFixed(3)}`);
    });
    
    // Step 5: Calculate TP for each team
    const results = [];
    
    sectionKeys.forEach(key => {
        const section = sectionGroups[key];
        
        section.teams.forEach(team => {
            let sciScores = [], repScores = [], oppScores = [], revScores = [];
            
            team.parsedGrades.forEach(g => {
                if (g.role === 'reporter_sci') sciScores = g.scores;
                else if (g.role === 'reporter_pres') repScores = g.scores;
                else if (g.role === 'opponent') oppScores = g.scores;
                else if (g.role === 'reviewer') revScores = g.scores;
            });
            
            // Raw TP
            const sci_raw = getTrimmedAverage(sciScores, 1.0);
            const rep_raw = getTrimmedAverage(repScores, 1.0);
            const opp_raw = getTrimmedAverage(oppScores, 1.0);
            const rev_raw = getTrimmedAverage(revScores, 1.0);
            
            const rawTP = SCI_WEIGHT * (sci_raw + rep_raw * PRESENTER_WEIGHT) 
                        + (OPP_WEIGHT * opp_raw) 
                        + (REV_WEIGHT * rev_raw);
            
            // Adjusted TP
            const sci = getTrimmedAverage(sciScores, section.leniency);
            const rep = getTrimmedAverage(repScores, section.leniency);
            const opp = getTrimmedAverage(oppScores, section.leniency);
            const rev = getTrimmedAverage(revScores, section.leniency);
            
            const TP = SCI_WEIGHT * (sci + rep * PRESENTER_WEIGHT) 
                     + (OPP_WEIGHT * opp) 
                     + (REV_WEIGHT * rev);
            
            results.push({
                teamId: team.id,
                teamName: team.name,
                nationality: team.nationality,
                sectionId: section.sectionId,
                sectionName: section.sectionName,
                sci_raw, rep_raw, opp_raw, rev_raw,
                sci, rep, opp, rev,
                rawTP,
                tp: TP,
                rp: 0,
                z_score: 0,
                leniency: section.leniency,
                tasks: (team.grades || []).map(g => g.task),
                grades: team.grades || []
            });
        });
    });
    
    // Step 6: Calculate global statistics
    const tpSum = results.reduce((acc, t) => acc + t.tp, 0);
    const globalMeanTp = results.length > 0 ? tpSum / results.length : 0;
    
    const tpVariance = results.reduce((acc, t) => acc + Math.pow(t.tp - globalMeanTp, 2), 0);
    let globalStdTp = results.length > 0 ? Math.sqrt(tpVariance / results.length) : 1;
    if (globalStdTp < 1) globalStdTp = 1;
    
    // Step 7: Calculate Z-score and RP
    results.forEach(team => {
        team.z_score = (team.tp - globalMeanTp) / globalStdTp;
        team.rp = 50.0 + (team.z_score * 10.0);
        team.score = team.rp;
    });
    
    // Step 8: Sort by RP
    results.sort((a, b) => b.rp - a.rp);
    
    // Step 9: Assign places
    let currentPlace = 1;
    results.forEach((team, index) => {
        if (index > 0 && Math.abs(team.rp - results[index - 1].rp) < 0.01) {
            team.place = results[index - 1].place;
        } else {
            team.place = currentPlace;
        }
        currentPlace++;
    });
    
    return results;
}

// ============================================
// C++ Score Calculation
// ============================================
async function calculateScores(teams, sections) {
    return new Promise((resolve) => {
        const cppPath = path.join(__dirname, 'score_calculator');
        
        if (!fs.existsSync(cppPath)) {
            console.log('C++ binary not found, using JavaScript fallback');
            resolve(fallbackCalculation(teams, sections));
            return;
        }

        try {
            const cppProcess = spawn(cppPath);
            let output = '';
            let errorOutput = '';

            cppProcess.stdout.on('data', (data) => {
                output += data.toString();
            });

            cppProcess.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            cppProcess.on('error', (error) => {
                console.error('C++ process error:', error);
                resolve(fallbackCalculation(teams, sections));
            });

            cppProcess.on('close', (code) => {
                if (code !== 0) {
                    console.error('C++ process exited with code:', code);
                    resolve(fallbackCalculation(teams, sections));
                    return;
                }
                try {
                    const result = JSON.parse(output);
                    resolve(result);
                } catch (error) {
                    console.error('JSON parse error:', error);
                    resolve(fallbackCalculation(teams, sections));
                }
            });

            // Send data to C++
            const teamsArray = Object.values(teams);
            teamsArray.forEach(team => {
                const sectionId = team.section || 'default';
                const sectionName = (sections[sectionId] && sections[sectionId].name) ? sections[sectionId].name : sectionId;
                const grades = team.grades || [];
                const gradeStr = grades.map(g => `${g.task}:${g.grade}`).join(',');
                
                const line = `${sectionId}|${sectionName}|${team.id}|${team.name}|${team.nationality}|${gradeStr}\n`;
                cppProcess.stdin.write(line);
            });
            cppProcess.stdin.end();

        } catch (error) {
            console.error('Error running C++ calculator:', error);
            resolve(fallbackCalculation(teams, sections));
        }
    });
}

async function updateLeaderboard() {
    const data = loadData();
    const leaderboard = await calculateScores(data.teams, data.sections);
    data.leaderboard = leaderboard;
    saveData(data);
    io.emit('leaderboardUpdate', leaderboard);
    return leaderboard;
}

// ============================================
// Auth Middleware
// ============================================
function requireAdmin(req, res, next) {
    if (req.session && req.session.isAdmin === true) {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
}

// ============================================
// Routes
// ============================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/api/login', (req, res) => {
    const { password } = req.body;
    console.log('Login attempt with password length:', password ? password.length : 0);
    
    if (password === ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ error: 'Session error' });
            }
            console.log('Login successful');
            res.json({ success: true });
        });
    } else {
        console.log('Invalid password');
        res.status(401).json({ error: 'Invalid password' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/check-auth', (req, res) => {
    res.json({ isAdmin: req.session && req.session.isAdmin === true });
});

app.get('/api/leaderboard', (req, res) => {
    const data = loadData();
    res.json(data.leaderboard || []);
});

// Sections API
app.get('/api/sections', requireAdmin, (req, res) => {
    const data = loadData();
    res.json(data.sections || {});
});

app.post('/api/sections', requireAdmin, async (req, res) => {
    try {
        const { id, name } = req.body;
        if (!name) return res.status(400).json({ error: 'Section name required' });
        
        const data = loadData();
        const sectionId = id || uuidv4();
        data.sections[sectionId] = { id: sectionId, name: name.trim() };
        saveData(data);
        res.json({ success: true, sectionId });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add section' });
    }
});

app.delete('/api/sections/:id', requireAdmin, async (req, res) => {
    try {
        const data = loadData();
        delete data.sections[req.params.id];
        Object.values(data.teams).forEach(team => {
            if (team.section === req.params.id) team.section = null;
        });
        saveData(data);
        await updateLeaderboard();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete section' });
    }
});

// Teams API
app.get('/api/teams', requireAdmin, (req, res) => {
    const data = loadData();
    res.json(data.teams || {});
});

app.post('/api/teams', requireAdmin, async (req, res) => {
    try {
        const { id, name, nationality, section } = req.body;
        if (!name || !nationality) return res.status(400).json({ error: 'Name and nationality required' });
        
        const data = loadData();
        const teamId = id || uuidv4();
        data.teams[teamId] = {
            id: teamId,
            name: name.trim(),
            nationality: nationality.trim().toUpperCase(),
            section: section || null,
            grades: data.teams[teamId]?.grades || []
        };
        saveData(data);
        await updateLeaderboard();
        res.json({ success: true, teamId });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add team' });
    }
});

app.delete('/api/teams/:id', requireAdmin, async (req, res) => {
    try {
        const data = loadData();
        delete data.teams[req.params.id];
        saveData(data);
        await updateLeaderboard();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete team' });
    }
});

// Grades API
app.post('/api/grades/upload', requireAdmin, async (req, res) => {
    try {
        const { gradesString } = req.body;
        if (!gradesString || !gradesString.trim()) return res.status(400).json({ error: 'Grades string required' });
        
        const data = loadData();
        const teamGrades = gradesString.split(';').filter(s => s.trim());
        let processedCount = 0;
        
        teamGrades.forEach(teamGradeStr => {
            const colonIndex = teamGradeStr.indexOf(':');
            if (colonIndex === -1) return;
            
            const teamIdentifier = teamGradeStr.substring(0, colonIndex).trim();
            const gradesStr = teamGradeStr.substring(colonIndex + 1).trim();
            
            let teamId = teamIdentifier;
            let sectionId = null;
            
            if (teamIdentifier.includes('|')) {
                const parts = teamIdentifier.split('|');
                if (parts.length === 3) {
                    const sectionName = parts[0].trim();
                    const teamName = parts[1].trim();
                    const nationality = parts[2].trim().toUpperCase();
                    
                    let foundSection = Object.entries(data.sections).find(([id, s]) => s.name === sectionName);
                    if (!foundSection) {
                        sectionId = uuidv4();
                        data.sections[sectionId] = { id: sectionId, name: sectionName };
                    } else {
                        sectionId = foundSection[0];
                    }
                    
                    let foundTeam = Object.entries(data.teams).find(([id, t]) => t.name === teamName);
                    if (!foundTeam) {
                        teamId = uuidv4();
                        data.teams[teamId] = {
                            id: teamId,
                            name: teamName,
                            nationality: nationality,
                            section: sectionId,
                            grades: []
                        };
                    } else {
                        teamId = foundTeam[0];
                        data.teams[teamId].section = sectionId;
                        if (nationality) data.teams[teamId].nationality = nationality;
                    }
                }
            }
            
            if (!data.teams[teamId]) {
                console.warn(`Team ${teamId} not found`);
                return;
            }
            
            if (sectionId) data.teams[teamId].section = sectionId;
            
            const grades = gradesStr.split(',').map(g => {
                const parts = g.trim().split(':');
                if (parts.length !== 2) return null;
                return { task: parts[0].trim(), grade: parts[1].trim(), max: 'N/A' };
            }).filter(g => g !== null);
            
            const existingGrades = data.teams[teamId].grades || [];
            const gradeMap = new Map(existingGrades.map(g => [g.task, g]));
            grades.forEach(g => gradeMap.set(g.task, g));
            data.teams[teamId].grades = Array.from(gradeMap.values());
            processedCount++;
        });
        
        saveData(data);
        const leaderboard = await updateLeaderboard();
        res.json({ success: true, processedCount, leaderboard });
    } catch (error) {
        console.error('Error parsing grades:', error);
        res.status(400).json({ error: 'Invalid grades format' });
    }
});

app.post('/api/grades', requireAdmin, async (req, res) => {
    try {
        const { teamId, task, grade } = req.body;
        if (!teamId || !task || !grade) return res.status(400).json({ error: 'Missing required fields' });
        
        const data = loadData();
        if (!data.teams[teamId]) return res.status(404).json({ error: 'Team not found' });
        
        const grades = data.teams[teamId].grades || [];
        const existingIndex = grades.findIndex(g => g.task === task);
        const gradeObj = { task: task.trim(), grade: grade.trim(), max: 'N/A' };
        
        if (existingIndex >= 0) grades[existingIndex] = gradeObj;
        else grades.push(gradeObj);
        
        data.teams[teamId].grades = grades;
        saveData(data);
        await updateLeaderboard();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add grade' });
    }
});

// Socket.IO
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    const data = loadData();
    socket.emit('leaderboardUpdate', data.leaderboard || []);
    socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// Start server
server.listen(PORT, () => {
    console.log('========================================');
    console.log('LASS Leaderboard Server Started');
    console.log('========================================');
    console.log(`Public: http://localhost:${PORT}`);
    console.log(`Admin: http://localhost:${PORT}/admin`);
    console.log(`Password: ${ADMIN_PASSWORD}`);
    console.log('========================================');
});
