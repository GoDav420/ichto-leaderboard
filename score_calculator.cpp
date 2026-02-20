#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <map>

// ============================================
// Configuration Constants (FIXED LASS)
// ============================================
const double PRESENTER_WEIGHT = 0.35;
const double SCI_WEIGHT = 2.0;
const double OPP_WEIGHT = 2.0;
const double REV_WEIGHT = 1.0;
const double LENIENCY_MIN = 0.6;
const double LENIENCY_MAX = 1.5;
const double LENIENCY_DAMPING = 1.0; // Only apply 50% of correction

// Grade conversion map
std::map<std::string, double> GRADE_MAP = {
    {"2", 2.0}, {"3-", 5.0}, {"3", 9.0}, {"3+", 14.0}, {"4-", 20.0},
    {"4", 27.0}, {"4+", 34.0}, {"5-", 42.0}, {"5", 51.0}, {"5+", 60.0}
};

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
    double sci_raw = 0.0, rep_raw = 0.0, opp_raw = 0.0, rev_raw = 0.0;
    double sci = 0.0, rep = 0.0, opp = 0.0, rev = 0.0;
    double rawTP = 0.0, TP = 0.0, RP = 0.0, z_score = 0.0;
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

double convertGrade(const std::string& score) {
    if (GRADE_MAP.count(score)) return GRADE_MAP[score];
    try { return std::stod(score); } catch (...) { return 0.0; }
}

std::vector<double> parseGradeString(const std::string& gradesStr) {
    std::vector<double> scores;
    std::stringstream ss(gradesStr);
    std::string grade;
    while (ss >> grade) {
        double val = convertGrade(grade);
        if (val > 0) scores.push_back(val);
    }
    return scores;
}

double getTrimmedAverage(const std::vector<double>& scores, double leniency = 1.0) {
    if (scores.empty()) return 0.0;
    std::vector<double> sorted = scores;
    std::sort(sorted.begin(), sorted.end());
    if (sorted.size() >= 3) {
        sorted.erase(sorted.begin());
        sorted.pop_back();
    }
    double sum = 0.0;
    for (double s : sorted) sum += s;
    double avg = sorted.empty() ? 0.0 : sum / sorted.size();
    return avg / leniency;
}

std::string escapeJson(const std::string& str) {
    std::string result;
    for (char c : str) {
        if (c == '"') result += "\\\"";
        else if (c == '\\') result += "\\\\";
        else if (c == '\n') result += "\\n";
        else result += c;
    }
    return result;
}

TeamData parseTeamData(const std::string& line) {
    TeamData team;
    std::stringstream ss(line);
    std::string segment;
    
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
                g.role = gradeToken.substr(0, colonPos);
                g.rawGradeStr = gradeToken.substr(colonPos + 1);
                g.role.erase(0, g.role.find_first_not_of(" \t"));
                g.rawGradeStr.erase(0, g.rawGradeStr.find_first_not_of(" \t"));
                g.scores = parseGradeString(g.rawGradeStr);
                team.grades.push_back(g);
            }
        }
    }
    return team;
}

void processAllTeams(std::vector<TeamData>& teams) {
    if (teams.empty()) return;
    
    std::map<std::string, SectionData> sections;
    
    for (TeamData& team : teams) {
        std::string secId = team.sectionId.empty() ? "default" : team.sectionId;
        if (sections.find(secId) == sections.end()) {
            sections[secId].sectionId = secId;
            sections[secId].sectionName = team.sectionName.empty() ? secId : team.sectionName;
        }
        sections[secId].teams.push_back(&team);
    }
    
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
    
    double globalMean = 27.0;
    if (!allGlobalScores.empty()) {
        double sum = 0.0;
        for (double s : allGlobalScores) sum += s;
        globalMean = sum / allGlobalScores.size();
    }
    
    for (auto& pair : sections) {
        SectionData& section = pair.second;
        if (globalMean > 0 && section.mean_raw_score > 0) {
            double rawRatio = section.mean_raw_score / globalMean;
            section.leniency_coefficient = 1.0 + (rawRatio - 1.0) * LENIENCY_DAMPING;
        } else {
            section.leniency_coefficient = 1.0;
        }
        section.leniency_coefficient = std::max(LENIENCY_MIN, 
            std::min(LENIENCY_MAX, section.leniency_coefficient));
    }
    
    for (auto& pair : sections) {
        SectionData& section = pair.second;
        for (TeamData* team : section.teams) {
            team->leniency = section.leniency_coefficient;
            std::vector<double> sci, rep, opp, rev;
            for (const Grade& g : team->grades) {
                if (g.role == "reporter_sci") sci = g.scores;
                else if (g.role == "reporter_pres") rep = g.scores;
                else if (g.role == "opponent") opp = g.scores;
                else if (g.role == "reviewer") rev = g.scores;
            }
            
            team->sci_raw = getTrimmedAverage(sci, 1.0);
            team->rep_raw = getTrimmedAverage(rep, 1.0);
            team->opp_raw = getTrimmedAverage(opp, 1.0);
            team->rev_raw = getTrimmedAverage(rev, 1.0);
            
            team->sci = getTrimmedAverage(sci, section.leniency_coefficient);
            team->rep = getTrimmedAverage(rep, section.leniency_coefficient);
            team->opp = getTrimmedAverage(opp, section.leniency_coefficient);
            team->rev = getTrimmedAverage(rev, section.leniency_coefficient);
            
            team->rawTP = SCI_WEIGHT * (team->sci_raw + team->rep_raw * PRESENTER_WEIGHT) 
                        + (OPP_WEIGHT * team->opp_raw) + (REV_WEIGHT * team->rev_raw);
            team->TP = SCI_WEIGHT * (team->sci + team->rep * PRESENTER_WEIGHT) 
                     + (OPP_WEIGHT * team->opp) + (REV_WEIGHT * team->rev);
        }
    }
    
    double tpSum = 0.0;
    for (const TeamData& team : teams) tpSum += team.TP;
    double globalMeanTp = teams.empty() ? 0.0 : tpSum / teams.size();
    
    double tpVariance = 0.0;
    for (const TeamData& team : teams) tpVariance += std::pow(team.TP - globalMeanTp, 2);
    double globalStdTp = teams.empty() ? 1.0 : std::sqrt(tpVariance / teams.size());
    if (globalStdTp < 1.0) globalStdTp = 1.0;
    
    for (TeamData& team : teams) {
        team.z_score = (team.TP - globalMeanTp) / globalStdTp;
        team.RP = 50.0 + (team.z_score * 10.0);
    }
    
    std::sort(teams.begin(), teams.end(), [](const TeamData& a, const TeamData& b) {
        return a.RP > b.RP;
    });
    
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
        std::cout << "\n    \"tp\": " << team.TP << ",";
        std::cout << "\n    \"rp\": " << team.RP << ",";
        std::cout << "\n    \"score\": " << team.RP << ",";
        std::cout << "\n    \"z_score\": " << team.z_score << ",";
        std::cout << "\n    \"leniency\": " << team.leniency << ",";
        std::cout << "\n    \"rawTP\": " << team.rawTP << ",";
        std::cout << "\n    \"tasks\": [";
        for (size_t j = 0; j < team.grades.size(); j++) {
            if (j > 0) std::cout << ", ";
            std::cout << "\"" << escapeJson(team.grades[j].role) << "\"";
        }
        std::cout << "]";
        std::cout << "\n  }";
    }
    std::cout << "\n]\n";
}

int main() {
    std::vector<TeamData> teams;
    std::string line;
    while (std::getline(std::cin, line)) {
        if (!line.empty() && line.find('|') != std::string::npos) {
            teams.push_back(parseTeamData(line));
        }
    }
    if (!teams.empty()) processAllTeams(teams);
    outputJSON(teams);
    return 0;
}
