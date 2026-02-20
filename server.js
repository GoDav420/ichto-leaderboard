// ============================================
// LASS JavaScript Fallback - FIXED VERSION
// ============================================
function parseGradeString(gradesStr) {
    if (!gradesStr) return [];
    const grades = gradesStr.trim().split(/\s+/);
    return grades.map(function(g) { return GRADE_MAP[g] || 0; }).filter(function(s) { return s > 0; });
}

function getTrimmedAverage(scores, leniency) {
    if (!scores || scores.length === 0) return 0;
    leniency = leniency || 1.0;
    
    // Copy and sort
    var sorted = scores.slice().sort(function(a, b) { return a - b; });
    
    // Trim if 3 or more scores
    if (sorted.length >= 3) {
        sorted = sorted.slice(1, -1); // Remove first (min) and last (max)
    }
    
    // Calculate average
    var sum = 0;
    for (var i = 0; i < sorted.length; i++) {
        sum += sorted[i];
    }
    var avg = sorted.length > 0 ? sum / sorted.length : 0;
    
    // Apply leniency adjustment (divide by leniency to normalize)
    return avg / leniency;
}

function fallbackCalculation(teams, sections) {
    var teamsArray = Object.values(teams);
    if (teamsArray.length === 0) return [];
    
    // Step 1: Group by section and collect all scores
    var sectionGroups = {};
    
    teamsArray.forEach(function(team) {
        var sectionId = team.section || 'default';
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
        
        var grades = team.grades || [];
        
        grades.forEach(function(g) {
            var scores = parseGradeString(g.grade);
            scores.forEach(function(s) {
                sectionGroups[sectionId].allScores.push(s);
            });
        });
        
        sectionGroups[sectionId].teams.push({
            id: team.id,
            name: team.name,
            nationality: team.nationality,
            section: team.section,
            grades: grades,
            parsedGrades: grades.map(function(g) {
                return {
                    role: g.task,
                    scores: parseGradeString(g.grade),
                    rawStr: g.grade
                };
            })
        });
    });
    
    // Step 2: Calculate section means
    var sectionKeys = Object.keys(sectionGroups);
    
    sectionKeys.forEach(function(key) {
        var section = sectionGroups[key];
        if (section.allScores.length > 0) {
            var sum = 0;
            for (var i = 0; i < section.allScores.length; i++) {
                sum += section.allScores[i];
            }
            section.meanRaw = sum / section.allScores.length;
        }
    });
    
    // Step 3: Calculate global mean
    var globalSum = 0;
    var globalCount = 0;
    
    sectionKeys.forEach(function(key) {
        var section = sectionGroups[key];
        section.allScores.forEach(function(s) {
            globalSum += s;
            globalCount++;
        });
    });
    
    var globalMean = globalCount > 0 ? globalSum / globalCount : 27.0; // Default to middle grade
    
    console.log('Global mean raw score:', globalMean);
    
    // Step 4: Calculate leniency with DAMPENED adjustment
    sectionKeys.forEach(function(key) {
        var section = sectionGroups[key];
        
        if (globalMean > 0 && section.meanRaw > 0) {
            // Calculate raw leniency ratio
            var rawLeniency = section.meanRaw / globalMean;
            
            // DAMPEN the adjustment: move only 50% toward the correction
            // This prevents over-correction
            section.leniency = 1.0 + (rawLeniency - 1.0) * 0.5;
        } else {
            section.leniency = 1.0;
        }
        
        // Clamp leniency to reasonable bounds
        section.leniency = Math.max(LENIENCY_MIN, Math.min(LENIENCY_MAX, section.leniency));
        
        console.log('Section', section.sectionName, '- Mean:', section.meanRaw.toFixed(2), 
                    '- Raw ratio:', (section.meanRaw / globalMean).toFixed(3),
                    '- Dampened leniency:', section.leniency.toFixed(3));
    });
    
    // Step 5: Calculate TP for each team
    var results = [];
    
    sectionKeys.forEach(function(key) {
        var section = sectionGroups[key];
        
        section.teams.forEach(function(team) {
            var sciScores = [];
            var repScores = [];
            var oppScores = [];
            var revScores = [];
            
            team.parsedGrades.forEach(function(g) {
                if (g.role === 'reporter_sci') sciScores = g.scores;
                else if (g.role === 'reporter_pres') repScores = g.scores;
                else if (g.role === 'opponent') oppScores = g.scores;
                else if (g.role === 'reviewer') revScores = g.scores;
            });
            
            // Calculate raw averages (no leniency)
            var sci_raw = getTrimmedAverage(sciScores, 1.0);
            var rep_raw = getTrimmedAverage(repScores, 1.0);
            var opp_raw = getTrimmedAverage(oppScores, 1.0);
            var rev_raw = getTrimmedAverage(revScores, 1.0);
            
            // Calculate adjusted averages (with leniency)
            var sci = getTrimmedAverage(sciScores, section.leniency);
            var rep = getTrimmedAverage(repScores, section.leniency);
            var opp = getTrimmedAverage(oppScores, section.leniency);
            var rev = getTrimmedAverage(revScores, section.leniency);
            
            // Calculate TP using LASS formula
            var TP = SCI_WEIGHT * (sci + rep * PRESENTER_WEIGHT) 
                   + (OPP_WEIGHT * opp) 
                   + (REV_WEIGHT * rev);
            
            // Also calculate raw TP for comparison
            var rawTP = SCI_WEIGHT * (sci_raw + rep_raw * PRESENTER_WEIGHT) 
                      + (OPP_WEIGHT * opp_raw) 
                      + (REV_WEIGHT * rev_raw);
            
            results.push({
                teamId: team.id,
                teamName: team.name,
                nationality: team.nationality,
                sectionId: section.sectionId,
                sectionName: section.sectionName,
                sci_raw: sci_raw,
                rep_raw: rep_raw,
                opp_raw: opp_raw,
                rev_raw: rev_raw,
                sci: sci,
                rep: rep,
                opp: opp,
                rev: rev,
                rawTP: rawTP,
                tp: TP,
                rp: 0,
                z_score: 0,
                leniency: section.leniency,
                tasks: (team.grades || []).map(function(g) { return g.task; }),
                grades: team.grades || []
            });
        });
    });
    
    // Step 6: Calculate global TP statistics
    var tpSum = 0;
    for (var i = 0; i < results.length; i++) {
        tpSum += results[i].tp;
    }
    var globalMeanTp = results.length > 0 ? tpSum / results.length : 0;
    
    var tpVariance = 0;
    for (var i = 0; i < results.length; i++) {
        tpVariance += Math.pow(results[i].tp - globalMeanTp, 2);
    }
    var globalStdTp = results.length > 0 ? Math.sqrt(tpVariance / results.length) : 1;
    if (globalStdTp < 1) globalStdTp = 1;
    
    console.log('Global TP - Mean:', globalMeanTp.toFixed(2), 'Std:', globalStdTp.toFixed(2));
    
    // Step 7: Calculate Z-score and RP
    results.forEach(function(team) {
        team.z_score = (team.tp - globalMeanTp) / globalStdTp;
        team.rp = 50.0 + (team.z_score * 10.0);
        team.score = team.rp;
    });
    
    // Step 8: Sort by RP descending
    results.sort(function(a, b) {
        return b.rp - a.rp;
    });
    
    // Step 9: Assign places with tie handling
    var currentPlace = 1;
    for (var i = 0; i < results.length; i++) {
        if (i > 0 && Math.abs(results[i].rp - results[i - 1].rp) < 0.01) {
            results[i].place = results[i - 1].place;
        } else {
            results[i].place = currentPlace;
        }
        currentPlace++;
    }
    
    // Debug output
    console.log('\n=== FINAL RANKINGS ===');
    results.forEach(function(team) {
        console.log(team.place + '. ' + team.teamName + 
                   ' (Section: ' + team.sectionName + 
                   ', L: ' + team.leniency.toFixed(3) + 
                   ', Raw TP: ' + team.rawTP.toFixed(1) + 
                   ', Adj TP: ' + team.tp.toFixed(1) + 
                   ', RP: ' + team.rp.toFixed(2) + ')');
    });
    
    return results;
}
