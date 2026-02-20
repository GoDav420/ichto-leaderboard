(function() {
    'use strict';
    
    var socket = io();
    var teams = {};
    var sections = {};
    var isAuthenticated = false;
    
    // DOM Elements
    var loginModal = document.getElementById('loginModal');
    var adminPanel = document.getElementById('adminPanel');
    var loginForm = document.getElementById('loginForm');
    var loginError = document.getElementById('loginError');
    var logoutBtn = document.getElementById('logoutBtn');
    var sectionForm = document.getElementById('sectionForm');
    var sectionsList = document.getElementById('sectionsList');
    var teamForm = document.getElementById('teamForm');
    var teamsList = document.getElementById('teamsList');
    var gradesForm = document.getElementById('gradesForm');
    var singleGradeForm = document.getElementById('singleGradeForm');
    var gradesOverview = document.getElementById('gradesOverview');
    var gradeTeamSelect = document.getElementById('gradeTeamId');
    var teamSectionSelect = document.getElementById('teamSection');
    var toast = document.getElementById('toast');
    
    // Utility Functions
    function showToast(message, type) {
        type = type || 'success';
        toast.textContent = message;
        toast.className = 'toast show ' + type;
        setTimeout(function() {
            toast.classList.remove('show');
        }, 3500);
    }
    
    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    function showLoginModal() {
        loginModal.style.display = 'flex';
        adminPanel.style.display = 'none';
        isAuthenticated = false;
    }
    
    function showAdminPanel() {
        loginModal.style.display = 'none';
        adminPanel.style.display = 'block';
        isAuthenticated = true;
        loadSections();
        loadTeams();
    }
    
    // Auth Functions
    function checkAuth() {
        fetch('/api/check-auth', { credentials: 'include' })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.isAdmin) {
                    showAdminPanel();
                } else {
                    showLoginModal();
                }
            })
            .catch(function() {
                showLoginModal();
            });
    }
    
    function login(password) {
        fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ password: password })
        })
        .then(function(res) {
            if (res.ok) {
                loginError.textContent = '';
                showAdminPanel();
                showToast('Login successful!');
            } else {
                loginError.textContent = 'Invalid password';
            }
        })
        .catch(function() {
            loginError.textContent = 'Connection error';
        });
    }
    
    function logout() {
        fetch('/api/logout', { method: 'POST', credentials: 'include' })
            .then(function() {
                showLoginModal();
                showToast('Logged out');
            })
            .catch(function(err) {
                console.error('Logout error:', err);
            });
    }
    
    // Sections Functions
    function loadSections() {
        fetch('/api/sections', { credentials: 'include' })
            .then(function(res) {
                if (res.status === 401) {
                    showLoginModal();
                    return null;
                }
                return res.json();
            })
            .then(function(data) {
                if (data) {
                    sections = data;
                    renderSectionsList();
                    updateSectionSelects();
                }
            })
            .catch(function(err) {
                console.error('Error loading sections:', err);
            });
    }
    
    function renderSectionsList() {
        var sectionsArray = Object.values(sections);
        
        if (sectionsArray.length === 0) {
            sectionsList.innerHTML = '<p class="loading-text">No sections yet</p>';
            return;
        }
        
        var html = sectionsArray.map(function(section) {
            return '<div class="team-card">' +
                '<div class="team-card-info">' +
                    '<h4>' + escapeHtml(section.name) + '</h4>' +
                    '<span>ID: ' + section.id.substring(0, 8) + '...</span>' +
                '</div>' +
                '<div class="team-card-actions">' +
                    '<button class="btn btn-small btn-danger" onclick="handleDeleteSection(\'' + section.id + '\', \'' + escapeHtml(section.name).replace(/'/g, "\\'") + '\')">🗑️ Delete</button>' +
                '</div>' +
            '</div>';
        }).join('');
        
        sectionsList.innerHTML = html;
    }
    
    function updateSectionSelects() {
        var sectionsArray = Object.values(sections);
        var options = '<option value="">No Section</option>' +
            sectionsArray.map(function(s) {
                return '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>';
            }).join('');
        teamSectionSelect.innerHTML = options;
    }
    
    function addSection(name) {
        fetch('/api/sections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name: name })
        })
        .then(function(res) {
            if (res.ok) {
                showToast('Section "' + name + '" added!');
                sectionForm.reset();
                loadSections();
            } else {
                showToast('Failed to add section', 'error');
            }
        })
        .catch(function() {
            showToast('Error adding section', 'error');
        });
    }
    
    function deleteSection(sectionId, sectionName) {
        if (!confirm('Delete section "' + sectionName + '"?')) return;
        
        fetch('/api/sections/' + sectionId, {
            method: 'DELETE',
            credentials: 'include'
        })
        .then(function(res) {
            if (res.ok) {
                showToast('Deleted "' + sectionName + '"');
                loadSections();
                loadTeams();
            } else {
                showToast('Delete failed', 'error');
            }
        })
        .catch(function() {
            showToast('Error deleting section', 'error');
        });
    }
    
    // Teams Functions
    function loadTeams() {
        fetch('/api/teams', { credentials: 'include' })
            .then(function(res) {
                if (res.status === 401) {
                    showLoginModal();
                    return null;
                }
                return res.json();
            })
            .then(function(data) {
                if (data) {
                    teams = data;
                    renderTeamsList();
                    updateTeamSelect();
                    renderGradesOverview();
                }
            })
            .catch(function(err) {
                console.error('Error loading teams:', err);
            });
    }
    
    function renderTeamsList() {
        var teamsArray = Object.values(teams);
        
        if (teamsArray.length === 0) {
            teamsList.innerHTML = '<p class="loading-text">No teams yet</p>';
            return;
        }
        
        var html = teamsArray.map(function(team) {
            var sectionName = (team.section && sections[team.section]) ? sections[team.section].name : 'No Section';
            return '<div class="team-card">' +
                '<div class="team-card-info">' +
                    '<h4>' + escapeHtml(team.name) + '</h4>' +
                    '<span>' + escapeHtml(team.nationality) + ' · ' + escapeHtml(sectionName) + '</span>' +
                '</div>' +
                '<div class="team-card-actions">' +
                    '<button class="btn btn-small btn-secondary" onclick="copyTeamId(\'' + team.id + '\')">📋 Copy ID</button>' +
                    '<button class="btn btn-small btn-danger" onclick="handleDeleteTeam(\'' + team.id + '\', \'' + escapeHtml(team.name).replace(/'/g, "\\'") + '\')">🗑️ Delete</button>' +
                '</div>' +
            '</div>';
        }).join('');
        
        teamsList.innerHTML = html;
    }
    
    function updateTeamSelect() {
        var teamsArray = Object.values(teams);
        var html = '<option value="">Select team</option>' +
            teamsArray.map(function(team) {
                var sectionName = (team.section && sections[team.section]) ? ' (' + sections[team.section].name + ')' : '';
                return '<option value="' + team.id + '">' + escapeHtml(team.name) + sectionName + '</option>';
            }).join('');
        gradeTeamSelect.innerHTML = html;
    }
    
    function addTeam(name, nationality, section) {
        fetch('/api/teams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name: name, nationality: nationality, section: section || null })
        })
        .then(function(res) {
            if (res.ok) {
                showToast('Team "' + name + '" added!');
                teamForm.reset();
                loadTeams();
            } else {
                showToast('Failed to add team', 'error');
            }
        })
        .catch(function() {
            showToast('Error adding team', 'error');
        });
    }
    
    function deleteTeam(teamId, teamName) {
        if (!confirm('Delete "' + teamName + '"?')) return;
        
        fetch('/api/teams/' + teamId, {
            method: 'DELETE',
            credentials: 'include'
        })
        .then(function(res) {
            if (res.ok) {
                showToast('Deleted "' + teamName + '"');
                loadTeams();
            } else {
                showToast('Delete failed', 'error');
            }
        })
        .catch(function() {
            showToast('Error deleting team', 'error');
        });
    }
    
    // Grades Functions
    function uploadGrades(gradesString) {
        fetch('/api/grades/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ gradesString: gradesString })
        })
        .then(function(res) { return res.json().then(function(data) { return { ok: res.ok, data: data }; }); })
        .then(function(result) {
            if (result.ok) {
                showToast('Grades uploaded! (' + result.data.processedCount + ' teams)');
                document.getElementById('gradesString').value = '';
                loadSections();
                loadTeams();
            } else {
                showToast(result.data.error || 'Upload failed', 'error');
            }
        })
        .catch(function() {
            showToast('Error uploading grades', 'error');
        });
    }
    
    function addSingleGrade(teamId, task, grade) {
        fetch('/api/grades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ teamId: teamId, task: task, grade: grade })
        })
        .then(function(res) {
            if (res.ok) {
                showToast('Grade added for ' + task);
                document.getElementById('gradeValue').value = '';
                loadTeams();
            } else {
                showToast('Failed to add grade', 'error');
            }
        })
        .catch(function() {
            showToast('Error adding grade', 'error');
        });
    }
    
    function renderGradesOverview() {
        var teamsArray = Object.values(teams);
        
        if (teamsArray.length === 0 || teamsArray.every(function(t) { return !t.grades || t.grades.length === 0; })) {
            gradesOverview.innerHTML = '<p class="loading-text">No grades yet</p>';
            return;
        }
        
        // Group by section
        var sectionGroups = {};
        teamsArray.forEach(function(team) {
            var sectionId = team.section || 'none';
            var sectionName = (sections[sectionId] && sections[sectionId].name) ? sections[sectionId].name : 'No Section';
            if (!sectionGroups[sectionId]) {
                sectionGroups[sectionId] = { name: sectionName, teams: [] };
            }
            sectionGroups[sectionId].teams.push(team);
        });
        
        var roles = ['reporter_sci', 'reporter_pres', 'opponent', 'reviewer'];
        var roleLabels = {
            'reporter_sci': 'R:Sci',
            'reporter_pres': 'R:Pres',
            'opponent': 'Opp',
            'reviewer': 'Rev'
        };
        
        var html = '';
        Object.keys(sectionGroups).forEach(function(sectionId) {
            var group = sectionGroups[sectionId];
            html += '<h4 style="margin-top: 20px; margin-bottom: 10px; color: #333;">' + escapeHtml(group.name) + '</h4>';
            html += '<table class="grades-table"><thead><tr><th>Team</th>';
            roles.forEach(function(r) {
                html += '<th>' + roleLabels[r] + '</th>';
            });
            html += '</tr></thead><tbody>';
            
            group.teams.forEach(function(team) {
                html += '<tr><td><strong>' + escapeHtml(team.name) + '</strong></td>';
                roles.forEach(function(role) {
                    var gradesList = team.grades || [];
                    var grade = gradesList.find(function(g) { return g.task === role; });
                    if (grade) {
                        html += '<td><span class="grade-badge">' + escapeHtml(grade.grade) + '</span></td>';
                    } else {
                        html += '<td>—</td>';
                    }
                });
                html += '</tr>';
            });
            
            html += '</tbody></table>';
        });
        
        gradesOverview.innerHTML = html;
    }
    
    // Global Functions
    window.copyTeamId = function(teamId) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(teamId).then(function() {
                showToast('Team ID copied!');
            });
        } else {
            showToast('Team ID: ' + teamId);
        }
    };
    
    window.handleDeleteTeam = function(teamId, teamName) {
        deleteTeam(teamId, teamName);
    };
    
    window.handleDeleteSection = function(sectionId, sectionName) {
        deleteSection(sectionId, sectionName);
    };
    
    // Event Listeners
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        login(document.getElementById('password').value);
    });
    
    logoutBtn.addEventListener('click', logout);
    
    sectionForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var name = document.getElementById('sectionName').value.trim();
        if (name) addSection(name);
    });
    
    teamForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var name = document.getElementById('teamName').value.trim();
        var nationality = document.getElementById('nationality').value.trim();
        var section = teamSectionSelect.value;
        if (name && nationality) addTeam(name, nationality, section);
    });
    
    gradesForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var gradesString = document.getElementById('gradesString').value.trim();
        if (gradesString) {
            uploadGrades(gradesString);
        } else {
            showToast('Enter grades string', 'error');
        }
    });
    
    singleGradeForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var teamId = document.getElementById('gradeTeamId').value;
        var task = document.getElementById('gradeTask').value;
        var grade = document.getElementById('gradeValue').value.trim();
        
        if (!teamId || !task || !grade) {
            showToast('Fill all fields', 'error');
            return;
        }
        
        addSingleGrade(teamId, task, grade);
    });
    
    socket.on('leaderboardUpdate', function() {
        if (isAuthenticated) {
            loadSections();
            loadTeams();
        }
    });
    
    // Initialize
    checkAuth();
})();