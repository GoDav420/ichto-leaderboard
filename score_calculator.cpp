#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <map>

// ============================================
// Configuration Constants (LASS) - FIXED
// ============================================
const double PRESENTER_WEIGHT = 0.35;
const double SCI_WEIGHT = 3.0;
const double OPP_WEIGHT = 2.0;
const double REV_WEIGHT = 1.0;
const double LENIENCY_MIN = 0.7;
const double LENIENCY_MAX = 1.4;
const double LENIENCY_DAMPING = 0.5;  // Only apply 50% of the correction

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
    std::vector<double> scores;
    std::string rawGradeStr;
};

struct TeamData {
    std::string teamId;
    std::string teamName;
    std::string nationality;
    std::string sectionId;
    std::string sectionName;
    std::vector<Grade> grades;
    
    double sci_raw = 0.0;
    double rep_raw = 0.0;
    double opp_raw = 0.0;
    double rev_raw = 0.0;
    
    double sci = 0.0;
    double rep = 0.0;
    double opp = 0.0;
    double rev = 0.0;
    
    double rawTP = 0.0;
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
    double leniency_coefficient = 1.0;
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
    
    std::vector<double> sorted = scores;
    std::sort(sorted.begin(), sorted.end());
    
    // Trim if 3+ scores
    if (sorted.size() >= 3) {
        sorted.erase(sorted.begin());  // Remove min
        sorted.pop_back();              // Remove max
    }
    
    double sum = 0.0;
    for (double s : sorted) sum += s;
    double avg = sorted.empty() ? 0.0 : sum / sorted.size();
    
    // Apply leniency adjustment
    return avg / leniency;
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
// ============================================
TeamData parseTeamData(const std::string& line) {
    TeamData team;
    std::stringstream ss(line);
    std::string token;
    
    std::getline(ss, team.sectionId, '|');
    std::getline(ss, team.sectionName, '|');
    std::getline(ss, team.teamId, '|');
    std::getline(ss, team.teamName, '|');
    std::getline(ss, team.nationality, '|');
    
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
// Process All Teams with FIXED LASS
// ============================================
void processAllTeams(std::vector<TeamData>& teams) {
    if (teams.empty()) return;
    
    // Group by section
    std::map<std::string, SectionData> sections;
    
    for (TeamData& team : teams) {
        std::string secId = team.sectionId.empty() ? "default" : team.sectionId;
        
        if (sections.find(secId) == sections.end()) {
            sections[secId].sectionId = secId;
            sections[secId].sectionName = team.sectionName.empty() ? secId : team.sectionName;
        }
        
        sections[secId].teams.push_back(&team);
    }
    
    // Calculate section means
    std::vector<double> allGlobalScores;
    
    for (auto& pair : sections) {
        SectionData& section = pair.second;
        std::vector<double> sectionScores;
        
        for (TeamData* team : section.teams) {
            for (const Grade& g : team->grades) {
                for (double score : g.scores) {
                    sectionScores.push_back(score);
                    allGlobalScores.push_back(score);
                }
            }
        }
        
        if (!sectionScores.empty()) {
            double sum = 0.0;
            for (double s : sectionScores) sum += s;
            section.mean_raw_score = sum / sectionScores.size();
        }
    }
    
    // Global mean
    double globalMean = 27.0;
    if (!allGlobalScores.empty()) {
        double sum = 0.0;
        for (double s : allGlobalScores) sum += s;
        globalMean = sum / allGlobalScores.size();
    }
    
    // Calculate DAMPENED leniency
    for (auto& pair : sections) {
        SectionData& section = pair.second;
        
        if (globalMean > 0 && section.mean_raw_score > 0) {
            double rawRatio = section.mean_raw_score / globalMean;
            // Apply damping: only 50% correction
            section.leniency_coefficient = 1.0 + (rawRatio - 1.0) * LENIENCY_DAMPING;
        } else {
            section.leniency_coefficient = 1.0;
        }
        
        // Clamp
        section.leniency_coefficient = std::max(LENIENCY_MIN, 
            std::min(LENIENCY_MAX, section.leniency_coefficient));
        
        std::cerr << "Section " << section.sectionName 
                  << " - Mean: " << section.mean_raw_score
                  << " - Leniency: " << section.leniency_coefficient << std::endl;
    }
    
    // Process each team
    for (auto& pair : sections) {
        SectionData& section = pair.second;
        
        for (TeamData* team : section.teams) {
            team->leniency = section.leniency_coefficient;
            
            std::vector<double> sciScores, repScores, oppScores, revScores;
            
            for (const Grade& g : team->grades) {
                if (g.role == "reporter_sci") sciScores = g.scores;
                else if (g.role == "reporter_pres") repScores = g.scores;
                else if (g.role == "opponent") oppScores = g.scores;
                else if (g.role == "reviewer") revScores = g.scores;
            }
            
            // Raw scores
            team->sci_raw = getTrimmedAverage(sciScores, 1.0);
            team->rep_raw = getTrimmedAverage(repScores, 1.0);
            team->opp_raw = getTrimmedAverage(oppScores, 1.0);
            team->rev_raw = getTrimmedAverage(revScores, 1.0);
            
            // Adjusted scores
            team->sci = getTrimmedAverage(sciScores, section.leniency_coefficient);
            team->rep = getTrimmedAverage(repScores, section.leniency_coefficient);
            team->opp = getTrimmedAverage(oppScores, section.leniency_coefficient);
            team->rev = getTrimmedAverage(revScores, section.leniency_coefficient);
            
            // Calculate TP
            team->rawTP = SCI_WEIGHT * (team->sci_raw + team->rep_raw * PRESENTER_WEIGHT) 
                        + (OPP_WEIGHT * team->opp_raw) 
                        + (REV_WEIGHT * team->rev_raw);
                        
            team->TP = SCI_WEIGHT * (team->sci + team->rep * PRESENTER_WEIGHT) 
                     + (OPP_WEIGHT * team->opp) 
                     + (REV_WEIGHT * team->rev);
        }
    }
    
    // Calculate global TP stats
    double tpSum = 0.0;
    for (const TeamData& team : teams) {
        tpSum += team.TP;
    }
    double globalMeanTp = teams.empty() ? 0.0 : tpSum / teams.size();
    
    double tpVariance = 0.0;
    for (const TeamData& team : teams) {
        tpVariance += std::pow(team.TP - globalMeanTp, 2);
    }
    double globalStdTp = teams.empty() ? 1.0 : std::sqrt(tpVariance / teams.size());
    if (globalStdTp < 1.0) globalStdTp = 1.0;
    
    // Calculate Z-score and RP
    for (TeamData& team : teams) {
        team.z_score = (team.TP - globalMeanTp) / globalStdTp;
        team.RP = 50.0 + (team.z_score * 10.0);
    }
    
    // Sort by RP
    std::sort(teams.begin(), teams.end(), [](const TeamData& a, const TeamData& b) {
        return a.RP > b.RP;
    });
    
    // Assign places
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
        
        std::cout << "\n    \"sci_raw\": " << std::fixed << std::setprecision(2) << team.sci_raw << ",";
        std::cout << "\n    \"rep_raw\": " << team.rep_raw << ",";
        std::cout << "\n    \"opp_raw\": " << team.opp_raw << ",";
        std::cout << "\n    \"rev_raw\": " << team.rev_raw << ",";
        std::cout << "\n    \"sci\": " << team.sci << ",";
        std::cout << "\n    \"rep\": " << team.rep << ",";
        std::cout << "\n    \"opp\": " << team.opp << ",";
        std::cout << "\n    \"rev\": " << team.rev << ",";
        
        std::cout << "\n    \"rawTP\": " << team.rawTP << ",";
        std::cout << "\n    \"tp\": " << team.TP << ",";
        std::cout << "\n    \"rp\": " << team.RP << ",";
        std::cout << "\n    \"score\": " << team.RP << ",";
        std::cout << "\n    \"z_score\": " << std::setprecision(3) << team.z_score << ",";
        std::cout << "\n    \"leniency\": " << team.leniency << ",";
        
        std::cout << "\n    \"tasks\": [";
        for (size_t j = 0; j < team.grades.size(); j++) {
            if (j > 0) std::cout << ", ";
            std::cout << "\"" << escapeJson(team.grades[j].role) << "\"";
        }
        std::cout << "],";
        
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
