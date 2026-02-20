#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <map>

// ============================================
// Configuration Constants (LASS)
// ============================================
const double PRESENTER_WEIGHT = 0.35;
const double SCI_WEIGHT = 3.0;
const double OPP_WEIGHT = 2.0;
const double REV_WEIGHT = 1.0;
const double LENIENCY_MIN = 0.6;
const double LENIENCY_MAX = 1.5;

// Grade conversion map
std::map<std::string, double> GRADE_MAP = {
    {"2", 2.0}, {"3-", 5.0}, {"3", 9.0}, {"3+", 14.0}, {"4-", 20.0},
    {"4", 27.0}, {"4+", 34.0}, {"5-", 42.0}, {"5", 51.0}, {"5+", 60.0}
};

// ============================================
// Data Structures
// ============================================
struct Grade {
    std::string role;
    std::vector<double> scores;  // Individual juror scores
    std::string rawGradeStr;     // Original grade string
};

struct TeamData {
    std::string teamId;
    std::string teamName;
    std::string nationality;
    std::string sectionId;
    std::string sectionName;
    std::vector<Grade> grades;
    
    // Raw scores (before leniency adjustment)
    double sci_raw = 0.0;
    double rep_raw = 0.0;
    double opp_raw = 0.0;
    double rev_raw = 0.0;
    
    // Adjusted scores (after leniency adjustment)
    double sci = 0.0;
    double rep = 0.0;
    double opp = 0.0;
    double rev = 0.0;
    
    double TP = 0.0;
    double RP = 0.0;
    double z_score = 0.0;
    double leniency = 1.0;
    int place = 0;
};

struct SectionData {
    std::string sectionId;
    std::string sectionName;
    std::vector<TeamData*> teams;
    double mean_raw_score = 0.0;
    double std_raw_score = 0.0;
    double mean_tp = 0.0;
    double std_tp = 0.0;
    double leniency_coefficient = 1.0;
    int jury_count = 0;
};

// ============================================
// Utility Functions
// ============================================

double convertGrade(const std::string& score) {
    if (GRADE_MAP.count(score)) {
        return GRADE_MAP[score];
    }
    try {
        return std::stod(score);
    } catch (...) {
        return 0.0;
    }
}

std::vector<double> parseGradeString(const std::string& gradesStr) {
    std::vector<double> scores;
    std::stringstream ss(gradesStr);
    std::string grade;
    
    while (ss >> grade) {
        double val = convertGrade(grade);
        if (val > 0) {
            scores.push_back(val);
        }
    }
    
    return scores;
}

double getTrimmedAverage(const std::vector<double>& scores, double leniency = 1.0) {
    if (scores.empty()) return 0.0;
    
    std::vector<double> adjusted;
    for (double s : scores) {
        adjusted.push_back(s / leniency);
    }
    
    std::sort(adjusted.begin(), adjusted.end());
    
    // If 3+ scores, trim highest and lowest
    if (adjusted.size() >= 3) {
        double sum = 0.0;
        int count = 0;
        for (size_t i = 1; i < adjusted.size() - 1; i++) {
            sum += adjusted[i];
            count++;
        }
        return count > 0 ? sum / count : 0.0;
    }
    
    // Otherwise, just average
    double sum = 0.0;
    for (double s : adjusted) sum += s;
    return sum / adjusted.size();
}

std::string escapeJson(const std::string& str) {
    std::string result;
    for (char c : str) {
        switch (c) {
            case '"': result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default: result += c; break;
        }
    }
    return result;
}

std::string trim(const std::string& str) {
    size_t start = str.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    size_t end = str.find_last_not_of(" \t\r\n");
    return str.substr(start, end - start + 1);
}

// ============================================
// Parse Input
// Format: sectionId|sectionName|teamId|teamName|nationality|role:grades,role:grades
// ============================================
TeamData parseTeamData(const std::string& line) {
    TeamData team;
    std::stringstream ss(line);
    std::string token;
    
    // Parse section info
    std::getline(ss, team.sectionId, '|');
    std::getline(ss, team.sectionName, '|');
    
    // Parse team info
    std::getline(ss, team.teamId, '|');
    std::getline(ss, team.teamName, '|');
    std::getline(ss, team.nationality, '|');
    
    // Parse grades
    std::string gradesStr;
    std::getline(ss, gradesStr);
    
    if (!gradesStr.empty()) {
        std::stringstream gradesSS(gradesStr);
        std::string gradeToken;
        
        while (std::getline(gradesSS, gradeToken, ',')) {
            if (gradeToken.empty()) continue;
            
            size_t colonPos = gradeToken.find(':');
            if (colonPos != std::string::npos) {
                Grade g;
                g.role = trim(gradeToken.substr(0, colonPos));
                g.rawGradeStr = trim(gradeToken.substr(colonPos + 1));
                g.scores = parseGradeString(g.rawGradeStr);
                team.grades.push_back(g);
            }
        }
    }
    
    return team;
}

// ============================================
// Calculate Section Statistics
// ============================================
void calculateSectionStatistics(SectionData& section) {
    if (section.teams.empty()) return;
    
    // Collect all raw scores
    std::vector<double> allScores;
    int maxJurors = 0;
    
    for (TeamData* team : section.teams) {
        for (const Grade& g : team->grades) {
            for (double score : g.scores) {
                allScores.push_back(score);
            }
            if (g.scores.size() > maxJurors) {
                maxJurors = g.scores.size();
            }
        }
    }
    
    section.jury_count = maxJurors;
    
    if (allScores.empty()) return;
    
    // Calculate mean
    double sum = 0.0;
    for (double s : allScores) sum += s;
    section.mean_raw_score = sum / allScores.size();
    
    // Calculate standard deviation
    double variance = 0.0;
    for (double s : allScores) {
        variance += (s - section.mean_raw_score) * (s - section.mean_raw_score);
    }
    section.std_raw_score = std::sqrt(variance / allScores.size());
}

// ============================================
// Process Team Scores with Leniency
// ============================================
void processTeamScores(TeamData& team, double leniency) {
    team.leniency = leniency;
    
    // Find scores for each role
    std::vector<double> sciScores, repScores, oppScores, revScores;
    
    for (const Grade& g : team.grades) {
        if (g.role == "reporter_sci" || g.role == "sci") {
            sciScores = g.scores;
        } else if (g.role == "reporter_pres" || g.role == "rep" || g.role == "pres") {
            repScores = g.scores;
        } else if (g.role == "opponent" || g.role == "opp") {
            oppScores = g.scores;
        } else if (g.role == "reviewer" || g.role == "rev") {
            revScores = g.scores;
        }
    }
    
    // Calculate raw scores (no leniency adjustment)
    team.sci_raw = getTrimmedAverage(sciScores, 1.0);
    team.rep_raw = getTrimmedAverage(repScores, 1.0);
    team.opp_raw = getTrimmedAverage(oppScores, 1.0);
    team.rev_raw = getTrimmedAverage(revScores, 1.0);
    
    // Calculate adjusted scores (with leniency)
    team.sci = getTrimmedAverage(sciScores, leniency);
    team.rep = getTrimmedAverage(repScores, leniency);
    team.opp = getTrimmedAverage(oppScores, leniency);
    team.rev = getTrimmedAverage(revScores, leniency);
    
    // Calculate TP using LASS formula
    team.TP = SCI_WEIGHT * (team.sci + team.rep * PRESENTER_WEIGHT) 
            + (OPP_WEIGHT * team.opp) 
            + (REV_WEIGHT * team.rev);
}

// ============================================
// Main Processing Function
// ============================================
void processAllTeams(std::vector<TeamData>& teams) {
    if (teams.empty()) return;
    
    // Group teams by section
    std::map<std::string, SectionData> sections;
    
    for (TeamData& team : teams) {
        std::string secId = team.sectionId.empty() ? "default" : team.sectionId;
        
        if (sections.find(secId) == sections.end()) {
            sections[secId].sectionId = secId;
            sections[secId].sectionName = team.sectionName.empty() ? secId : team.sectionName;
        }
        
        sections[secId].teams.push_back(&team);
    }
    
    // Calculate statistics for each section
    for (auto& pair : sections) {
        calculateSectionStatistics(pair.second);
    }
    
    // Calculate global mean raw score
    double globalSum = 0.0;
    double globalCount = 0.0;
    
    for (const auto& pair : sections) {
        for (TeamData* team : pair.second.teams) {
            for (const Grade& g : team->grades) {
                for (double score : g.scores) {
                    globalSum += score;
                    globalCount += 1.0;
                }
            }
        }
    }
    
    double globalMean = globalCount > 0 ? globalSum / globalCount : 0.0;
    
    // Calculate leniency coefficient for each section
    for (auto& pair : sections) {
        SectionData& section = pair.second;
        
        if (globalMean > 0 && section.mean_raw_score > 0) {
            section.leniency_coefficient = section.mean_raw_score / globalMean;
        } else {
            section.leniency_coefficient = 1.0;
        }
        
        // Clamp leniency
        section.leniency_coefficient = std::max(LENIENCY_MIN, 
            std::min(LENIENCY_MAX, section.leniency_coefficient));
    }
    
    // Process each team with section leniency
    for (auto& pair : sections) {
        SectionData& section = pair.second;
        
        for (TeamData* team : section.teams) {
            processTeamScores(*team, section.leniency_coefficient);
        }
        
        // Calculate section TP statistics
        double tpSum = 0.0;
        for (TeamData* team : section.teams) {
            tpSum += team->TP;
        }
        section.mean_tp = section.teams.empty() ? 0.0 : tpSum / section.teams.size();
        
        double tpVariance = 0.0;
        for (TeamData* team : section.teams) {
            tpVariance += std::pow(team->TP - section.mean_tp, 2);
        }
        section.std_tp = section.teams.empty() ? 0.0 : 
            std::sqrt(tpVariance / section.teams.size());
    }
    
    // Calculate global TP statistics for Z-score
    double globalTpSum = 0.0;
    double teamCount = 0.0;
    
    for (TeamData& team : teams) {
        globalTpSum += team.TP;
        teamCount += 1.0;
    }
    
    double globalMeanTp = teamCount > 0 ? globalTpSum / teamCount : 0.0;
    
    double globalTpVariance = 0.0;
    for (TeamData& team : teams) {
        globalTpVariance += std::pow(team.TP - globalMeanTp, 2);
    }
    double globalStdTp = teamCount > 0 ? std::sqrt(globalTpVariance / teamCount) : 1.0;
    if (globalStdTp < 1.0) globalStdTp = 1.0;
    
    // Calculate Z-score and RP for each team
    for (TeamData& team : teams) {
        team.z_score = (team.TP - globalMeanTp) / globalStdTp;
        // RP normalized to nice range (50 ± 10*z)
        team.RP = 50.0 + (team.z_score * 10.0);
    }
    
    // Sort by RP descending
    std::sort(teams.begin(), teams.end(), [](const TeamData& a, const TeamData& b) {
        return a.RP > b.RP;
    });
    
    // Assign places (handle ties)
    int currentPlace = 1;
    for (size_t i = 0; i < teams.size(); i++) {
        if (i > 0 && std::abs(teams[i].RP - teams[i-1].RP) < 0.01) {
            teams[i].place = teams[i-1].place;
        } else {
            teams[i].place = currentPlace;
        }
        currentPlace++;
    }
}

// ============================================
// Output JSON
// ============================================
void outputJSON(std::vector<TeamData>& teams) {
    std::cout << "[";
    
    for (size_t i = 0; i < teams.size(); i++) {
        const TeamData& team = teams[i];
        
        if (i > 0) std::cout << ",";
        
        std::cout << "\n  {";
        std::cout << "\n    \"place\": " << team.place << ",";
        std::cout << "\n    \"teamId\": \"" << escapeJson(team.teamId) << "\",";
        std::cout << "\n    \"teamName\": \"" << escapeJson(team.teamName) << "\",";
        std::cout << "\n    \"nationality\": \"" << escapeJson(team.nationality) << "\",";
        std::cout << "\n    \"sectionId\": \"" << escapeJson(team.sectionId) << "\",";
        std::cout << "\n    \"sectionName\": \"" << escapeJson(team.sectionName) << "\",";
        
        // Scores
        std::cout << "\n    \"sci_raw\": " << std::fixed << std::setprecision(2) << team.sci_raw << ",";
        std::cout << "\n    \"rep_raw\": " << team.rep_raw << ",";
        std::cout << "\n    \"opp_raw\": " << team.opp_raw << ",";
        std::cout << "\n    \"rev_raw\": " << team.rev_raw << ",";
        std::cout << "\n    \"sci\": " << team.sci << ",";
        std::cout << "\n    \"rep\": " << team.rep << ",";
        std::cout << "\n    \"opp\": " << team.opp << ",";
        std::cout << "\n    \"rev\": " << team.rev << ",";
        
        // Calculated values
        std::cout << "\n    \"tp\": " << team.TP << ",";
        std::cout << "\n    \"rp\": " << team.RP << ",";
        std::cout << "\n    \"score\": " << team.RP << ",";
        std::cout << "\n    \"z_score\": " << std::setprecision(3) << team.z_score << ",";
        std::cout << "\n    \"leniency\": " << team.leniency << ",";
        
        // Tasks
        std::cout << "\n    \"tasks\": [";
        for (size_t j = 0; j < team.grades.size(); j++) {
            if (j > 0) std::cout << ", ";
            std::cout << "\"" << escapeJson(team.grades[j].role) << "\"";
        }
        std::cout << "],";
        
        // Grades
        std::cout << "\n    \"grades\": [";
        for (size_t j = 0; j < team.grades.size(); j++) {
            if (j > 0) std::cout << ", ";
            std::cout << "{\"task\": \"" << escapeJson(team.grades[j].role) 
                      << "\", \"grade\": \"" << escapeJson(team.grades[j].rawGradeStr) 
                      << "\", \"max\": \"N/A\"}";
        }
        std::cout << "]";
        
        std::cout << "\n  }";
    }
    
    std::cout << "\n]\n";
}

// ============================================
// Main
// ============================================
int main() {
    std::vector<TeamData> teams;
    std::string line;
    
    while (std::getline(std::cin, line)) {
        if (!line.empty() && line.find('|') != std::string::npos) {
            teams.push_back(parseTeamData(line));
        }
    }
    
    if (!teams.empty()) {
        processAllTeams(teams);
    }
    
    outputJSON(teams);
    
    return 0;
}