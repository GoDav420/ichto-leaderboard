(function() {
    'use strict';
    
    var socket = io();
    var leaderboardBody = document.getElementById('leaderboardBody');
    var lastUpdateEl = document.getElementById('lastUpdate');
    var previousData = [];
    
    // Country flag mapping
    var FLAGS = {
        'USA': '🇺🇸', 'US': '🇺🇸',
        'GER': '🇩🇪', 'DE': '🇩🇪',
        'JPN': '🇯🇵', 'JP': '🇯🇵',
        'GBR': '🇬🇧', 'UK': '🇬🇧', 'GB': '🇬🇧',
        'FRA': '🇫🇷', 'FR': '🇫🇷',
        'ITA': '🇮🇹', 'IT': '🇮🇹',
        'ESP': '🇪🇸', 'ES': '🇪🇸',
        'CAN': '🇨🇦', 'CA': '🇨🇦',
        'AUS': '🇦🇺', 'AU': '🇦🇺',
        'CHN': '🇨🇳', 'CN': '🇨🇳',
        'KOR': '🇰🇷', 'KR': '🇰🇷',
        'IND': '🇮🇳', 'IN': '🇮🇳',
        'BRA': '🇧🇷', 'BR': '🇧🇷',
        'RUS': '🇷🇺', 'RU': '🇷🇺',
        'POL': '🇵🇱', 'PL': '🇵🇱',
        'NED': '🇳🇱', 'NL': '🇳🇱',
        'SWE': '🇸🇪', 'SE': '🇸🇪'
    };
    
    function getFlag(nationality) {
        if (!nationality) return '🏳️';
        var code = nationality.toUpperCase().trim();
        return FLAGS[code] || '🏳️';
    }
    
    function getMedal(place) {
        if (place === 1) return '🥇 ';
        if (place === 2) return '🥈 ';
        if (place === 3) return '🥉 ';
        return '';
    }
    
    function getPlaceClass(place) {
        if (place === 1) return 'place-1';
        if (place === 2) return 'place-2';
        if (place === 3) return 'place-3';
        return '';
    }
    
    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        var div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }
    
    function formatTaskName(task) {
        if (!task) return '';
        var shortNames = {
            'reporter_sci': 'Reporter (Sci)',
            'reporter_pres': 'Reporter (Pres)',
            'opponent': 'Opponent',
            'reviewer': 'Reviewer'
        };
        return shortNames[task] || task;
    }
    
    function formatNumber(num) {
        if (num === undefined || num === null || isNaN(Number(num))) return '0.00';
        return Number(num).toFixed(2);
    }
    
    function renderLeaderboard(data) {
        console.log('Rendering leaderboard with data:', data);
        
        // Validate data
        if (!data || !Array.isArray(data) || data.length === 0) {
            leaderboardBody.innerHTML = 
                '<tr class="loading-row">' +
                    '<td colspan="7">No teams yet. Add teams in admin panel!</td>' +
                '</tr>';
            previousData = [];
            return;
        }
        
        var html = '';
        
        for (var i = 0; i < data.length; i++) {
            var team = data[i];
            
            if (!team) continue;
            
            // Extract data with fallbacks
            var place = team.place || (i + 1);
            var teamName = team.teamName || team.name || 'Unknown Team';
            var nationality = team.nationality || '';
            var sectionName = team.sectionName || team.sectionId || 'N/A';
            var tp = team.tp || 0;
            var rp = team.rp || team.score || 0;
            var tasks = team.tasks || [];
            
            // Debug log
            console.log('Team ' + i + ':', {
                place: place,
                name: teamName,
                nationality: nationality,
                section: sectionName,
                tp: tp,
                rp: rp,
                tasks: tasks
            });
            
            // Build task badges HTML
            var taskBadgesHtml = '';
            if (tasks && tasks.length > 0) {
                for (var j = 0; j < tasks.length; j++) {
                    taskBadgesHtml += '<span class="task-badge">' + escapeHtml(formatTaskName(tasks[j])) + '</span>';
                }
            } else {
                taskBadgesHtml = '<span class="no-tasks">-</span>';
            }
            
            // Build row HTML
            html += '<tr>' +
                '<td class="place-col" data-label="Place">' +
                    '<span class="place ' + getPlaceClass(place) + '">' +
                        getMedal(place) + place +
                    '</span>' +
                '</td>' +
                '<td class="team-col" data-label="Team">' +
                    '<span class="team-name">' + escapeHtml(teamName) + '</span>' +
                '</td>' +
                '<td class="nationality-col" data-label="Country">' +
                    '<span class="nationality">' +
                        '<span class="flag">' + getFlag(nationality) + '</span> ' +
                        escapeHtml(nationality) +
                    '</span>' +
                '</td>' +
                '<td class="section-col" data-label="Section">' +
                    '<span class="section-badge">' + escapeHtml(sectionName) + '</span>' +
                '</td>' +
                '<td class="tp-col" data-label="TP">' +
                    '<span class="tp-score">' + formatNumber(tp) + '</span>' +
                '</td>' +
                '<td class="rp-col" data-label="RP">' +
                    '<span class="rp-score">' + formatNumber(rp) + '</span>' +
                '</td>' +
                '<td class="tasks-col" data-label="Tasks">' +
                    '<div class="tasks-list">' + taskBadgesHtml + '</div>' +
                '</td>' +
            '</tr>';
        }
        
        leaderboardBody.innerHTML = html;
        lastUpdateEl.textContent = 'Last update: ' + new Date().toLocaleTimeString();
        previousData = data;
    }
    
    // Socket connection
    socket.on('connect', function() {
        console.log('Connected to server');
    });
    
    socket.on('disconnect', function() {
        console.log('Disconnected from server');
    });
    
    socket.on('leaderboardUpdate', function(data) {
        console.log('Received leaderboard update:', data);
        renderLeaderboard(data);
    });
    
    // Initial fetch
    fetch('/api/leaderboard')
        .then(function(response) {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(function(data) {
            console.log('Initial leaderboard data:', data);
            renderLeaderboard(data);
        })
        .catch(function(error) {
            console.error('Error fetching leaderboard:', error);
            leaderboardBody.innerHTML = 
                '<tr class="loading-row">' +
                    '<td colspan="7">Error loading leaderboard. Please refresh.</td>' +
                '</tr>';
        });
})();