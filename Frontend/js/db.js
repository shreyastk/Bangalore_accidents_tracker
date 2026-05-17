/**
 * db.js — Data Layer Abstraction for Bangalore Accidents Tracker
 * 
 * This file acts as the single source of truth for all data operations.
 * To connect a real backend (Firebase, Supabase, REST API), replace the
 * localStorage implementations below with real API calls.
 */

(function () {
  'use strict';

  // ─── DEMO ACCIDENT DATA ───────────────────────────────────────────────────
  // 55 realistic accident-prone locations across Bangalore with coordinates.
  // Replace/augment with real data from your cleaned.xlsx.

  const DEMO_ACCIDENTS = [
    // Silk Board Junction Area
    { id: 'acc001', lat: 12.9176, lng: 77.6237, location: 'Silk Board Junction', area: 'Silk Board', severity: 'fatal', date: '2024-11-12', time: '08:23', description: 'Multi-vehicle pile-up during peak hours. 2 fatalities.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc002', lat: 12.9158, lng: 77.6219, location: 'Silk Board Flyover', area: 'Silk Board', severity: 'serious', date: '2024-10-05', time: '19:45', description: 'Two-wheeler vs heavy vehicle collision near flyover ramp.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc003', lat: 12.9201, lng: 77.6255, location: 'BTM Layout 1st Stage', area: 'Silk Board', severity: 'minor', date: '2024-09-22', time: '07:10', description: 'Auto-rickshaw collision at signal.', source: 'demo', verified: true, reportedBy: null },

    // Hebbal Flyover Area
    { id: 'acc004', lat: 13.0358, lng: 77.5970, location: 'Hebbal Flyover', area: 'Hebbal', severity: 'fatal', date: '2024-11-01', time: '22:15', description: 'Speeding car lost control on flyover. 1 fatality.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc005', lat: 13.0380, lng: 77.5985, location: 'Hebbal Lake Road', area: 'Hebbal', severity: 'serious', date: '2024-08-14', time: '06:30', description: 'Truck vs car collision near lake junction.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc006', lat: 13.0340, lng: 77.5955, location: 'Hebbal Bus Stop', area: 'Hebbal', severity: 'minor', date: '2024-07-20', time: '17:55', description: 'Three-wheeler accident near bus depot.', source: 'demo', verified: true, reportedBy: null },

    // KR Puram Bridge
    { id: 'acc007', lat: 13.0007, lng: 77.6930, location: 'KR Puram Bridge', area: 'KR Puram', severity: 'fatal', date: '2024-10-18', time: '21:00', description: 'Hit and run incident on bridge. 1 fatality.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc008', lat: 13.0025, lng: 77.6915, location: 'KR Puram Junction', area: 'KR Puram', severity: 'serious', date: '2024-09-03', time: '16:20', description: 'Two-wheeler skidded on wet road.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc009', lat: 12.9985, lng: 77.6945, location: 'KR Puram Old Madras Road', area: 'KR Puram', severity: 'serious', date: '2024-06-11', time: '14:05', description: 'Bus and auto collision near railway gate.', source: 'demo', verified: true, reportedBy: null },

    // Outer Ring Road
    { id: 'acc010', lat: 12.9352, lng: 77.6961, location: 'Marathahalli ORR', area: 'Outer Ring Road', severity: 'fatal', date: '2024-11-20', time: '02:30', description: 'Speeding vehicle accident in early morning hours.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc011', lat: 12.9578, lng: 77.6964, location: 'Tin Factory Junction', area: 'Outer Ring Road', severity: 'serious', date: '2024-10-25', time: '09:15', description: 'Signal jump caused four-vehicle collision.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc012', lat: 12.9780, lng: 77.7040, location: 'Kadubeesanahalli ORR', area: 'Outer Ring Road', severity: 'minor', date: '2024-09-15', time: '11:30', description: 'Rear-end collision in slow traffic.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc013', lat: 12.9131, lng: 77.6857, location: 'HSR Layout Sector 7', area: 'Outer Ring Road', severity: 'serious', date: '2024-08-28', time: '20:45', description: 'Two-wheeler vs car at night.', source: 'demo', verified: true, reportedBy: null },

    // Hosur Road
    { id: 'acc014', lat: 12.8740, lng: 77.6012, location: 'Bannerghatta-Hosur Junction', area: 'Hosur Road', severity: 'fatal', date: '2024-11-08', time: '18:00', description: 'Heavy vehicle turned without signaling. 1 fatality.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc015', lat: 12.8532, lng: 77.6241, location: 'Electronic City Phase 2', area: 'Hosur Road', severity: 'serious', date: '2024-10-12', time: '07:45', description: 'Truck vs two-wheeler near flyover.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc016', lat: 12.8334, lng: 77.6396, location: 'Electronic City Flyover', area: 'Hosur Road', severity: 'minor', date: '2024-09-07', time: '13:20', description: 'Minor fender bender due to sudden braking.', source: 'demo', verified: true, reportedBy: null },

    // Tumkur Road
    { id: 'acc017', lat: 13.0512, lng: 77.5338, location: 'Yeshwanthpur Circle', area: 'Tumkur Road', severity: 'fatal', date: '2024-10-30', time: '23:45', description: 'Drunk driving accident. 2 fatalities.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc018', lat: 13.0620, lng: 77.5155, location: 'Peenya Industrial Area', area: 'Tumkur Road', severity: 'serious', date: '2024-09-19', time: '14:30', description: 'Heavy truck overturned near Peenya junction.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc019', lat: 13.0701, lng: 77.5020, location: 'Jalahalli Cross', area: 'Tumkur Road', severity: 'minor', date: '2024-08-05', time: '10:00', description: 'Side-swipe accident at narrow stretch.', source: 'demo', verified: true, reportedBy: null },

    // MG Road & CBD
    { id: 'acc020', lat: 12.9762, lng: 77.6033, location: 'MG Road Trinity Metro', area: 'MG Road', severity: 'minor', date: '2024-11-10', time: '15:00', description: 'Pedestrian accident near metro exit.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc021', lat: 12.9721, lng: 77.5917, location: 'Brigade Road Junction', area: 'MG Road', severity: 'minor', date: '2024-10-01', time: '22:30', description: 'Two-wheeler skidded on oily road.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc022', lat: 12.9697, lng: 77.5741, location: 'Majestic Bus Stand', area: 'MG Road', severity: 'serious', date: '2024-09-10', time: '08:00', description: 'Bus hit pedestrian near overbridge.', source: 'demo', verified: true, reportedBy: null },

    // Koramangala
    { id: 'acc023', lat: 12.9352, lng: 77.6245, location: 'Koramangala 4th Block', area: 'Koramangala', severity: 'minor', date: '2024-11-05', time: '12:15', description: 'Cab accident during lunch peak.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc024', lat: 12.9279, lng: 77.6271, location: 'Koramangala Forum Mall', area: 'Koramangala', severity: 'serious', date: '2024-10-14', time: '19:30', description: 'Vehicle ran signal near mall junction.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc025', lat: 12.9412, lng: 77.6180, location: 'Sony World Junction', area: 'Koramangala', severity: 'minor', date: '2024-09-25', time: '16:00', description: 'Minor collision in heavy traffic.', source: 'demo', verified: true, reportedBy: null },

    // Indiranagar
    { id: 'acc026', lat: 12.9784, lng: 77.6407, location: '100 Feet Road Indiranagar', area: 'Indiranagar', severity: 'serious', date: '2024-11-15', time: '21:00', description: 'Two-wheelers collided at speed.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc027', lat: 12.9761, lng: 77.6385, location: 'CMH Road Junction', area: 'Indiranagar', severity: 'minor', date: '2024-10-20', time: '07:00', description: 'Early morning fender bender.', source: 'demo', verified: true, reportedBy: null },

    // Whitefield
    { id: 'acc028', lat: 12.9715, lng: 77.7483, location: 'Whitefield Main Road', area: 'Whitefield', severity: 'fatal', date: '2024-11-03', time: '06:00', description: 'Speeding vehicle on empty road. 1 fatality.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc029', lat: 12.9618, lng: 77.7566, location: 'Hopefarm Junction', area: 'Whitefield', severity: 'serious', date: '2024-10-08', time: '18:30', description: 'Signal violation caused multiple vehicle collision.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc030', lat: 12.9801, lng: 77.7318, location: 'ITPL Main Gate', area: 'Whitefield', severity: 'minor', date: '2024-09-18', time: '09:00', description: 'Traffic congestion accident near tech park.', source: 'demo', verified: true, reportedBy: null },

    // Bannerghatta Road
    { id: 'acc031', lat: 12.9004, lng: 77.5944, location: 'JP Nagar 3rd Phase', area: 'Bannerghatta Road', severity: 'serious', date: '2024-11-18', time: '17:00', description: 'Bus vs car accident at junction.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc032', lat: 12.8852, lng: 77.5961, location: 'Bannerghatta Road NICE Junction', area: 'Bannerghatta Road', severity: 'fatal', date: '2024-10-22', time: '03:00', description: 'Truck hit stranded vehicle. 1 fatality.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc033', lat: 12.8623, lng: 77.5928, location: 'Gottigere Junction', area: 'Bannerghatta Road', severity: 'minor', date: '2024-09-12', time: '15:30', description: 'Two-wheeler slid on loose gravel.', source: 'demo', verified: true, reportedBy: null },

    // Old Airport Road
    { id: 'acc034', lat: 12.9598, lng: 77.6490, location: 'Domlur Flyover', area: 'Old Airport Road', severity: 'serious', date: '2024-11-07', time: '20:00', description: 'Car overturned on flyover curve.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc035', lat: 12.9634, lng: 77.6629, location: 'Marathahalli Bridge', area: 'Old Airport Road', severity: 'minor', date: '2024-10-16', time: '08:30', description: 'Slow traffic collision on bridge.', source: 'demo', verified: true, reportedBy: null },

    // NH-44 / Bellary Road
    { id: 'acc036', lat: 13.0720, lng: 77.5880, location: 'Yelahanka Junction', area: 'Bellary Road', severity: 'fatal', date: '2024-10-28', time: '05:30', description: 'Container truck overturned. 2 fatalities.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc037', lat: 13.0985, lng: 77.5893, location: 'Doddaballapur Road Junction', area: 'Bellary Road', severity: 'serious', date: '2024-09-30', time: '12:00', description: 'Head-on collision on divided road.', source: 'demo', verified: true, reportedBy: null },

    // Sarjapur Road
    { id: 'acc038', lat: 12.9085, lng: 77.6825, location: 'Sarjapur Road Signal', area: 'Sarjapur Road', severity: 'serious', date: '2024-11-14', time: '18:45', description: 'Two vehicles collided running red light.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc039', lat: 12.8952, lng: 77.7052, location: 'Carmelaram Junction', area: 'Sarjapur Road', severity: 'minor', date: '2024-10-09', time: '11:00', description: 'Two-wheeler skid on road bump.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc040', lat: 12.8722, lng: 77.7155, location: 'Dommasandra Circle', area: 'Sarjapur Road', severity: 'fatal', date: '2024-09-08', time: '00:30', description: 'Hit and run at midnight. 1 pedestrian fatality.', source: 'demo', verified: true, reportedBy: null },

    // Mysore Road
    { id: 'acc041', lat: 12.9572, lng: 77.5278, location: 'Kengeri Upanagara', area: 'Mysore Road', severity: 'serious', date: '2024-11-09', time: '19:15', description: 'Truck vs auto-rickshaw on highway.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc042', lat: 12.9437, lng: 77.5135, location: 'Mysore Road NICE Interchange', area: 'Mysore Road', severity: 'fatal', date: '2024-10-04', time: '04:15', description: 'Speeding bus accident on expressway. 3 fatalities.', source: 'demo', verified: true, reportedBy: null },

    // RT Nagar / Mathikere
    { id: 'acc043', lat: 13.0203, lng: 77.5804, location: 'RT Nagar Main Road', area: 'North Bangalore', severity: 'minor', date: '2024-11-11', time: '14:00', description: 'Parking conflict turned into accident.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc044', lat: 13.0281, lng: 77.5521, location: 'Mathikere Circle', area: 'North Bangalore', severity: 'serious', date: '2024-10-17', time: '10:30', description: 'Wrong side driver caused collision.', source: 'demo', verified: true, reportedBy: null },

    // Additional High-Frequency Points
    { id: 'acc045', lat: 12.9352, lng: 77.6900, location: 'Marathahalli Village', area: 'Outer Ring Road', severity: 'minor', date: '2024-11-02', time: '16:00', description: 'Auto vs car scrape incident.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc046', lat: 12.9190, lng: 77.6230, location: 'BTM 2nd Stage', area: 'Silk Board', severity: 'serious', date: '2024-10-31', time: '23:00', description: 'Late-night speeding accident.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc047', lat: 13.0353, lng: 77.6007, location: 'Hebbal Outer Ring Road', area: 'Hebbal', severity: 'minor', date: '2024-10-03', time: '08:00', description: 'Morning rush hour fender bender.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc048', lat: 12.9748, lng: 77.7450, location: 'Whitefield Kadugodi', area: 'Whitefield', severity: 'serious', date: '2024-09-28', time: '15:00', description: 'Car flipped on speed bump.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc049', lat: 12.9108, lng: 77.6044, location: 'JP Nagar 6th Phase', area: 'Bannerghatta Road', severity: 'minor', date: '2024-09-05', time: '13:00', description: 'Narrow road collision.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc050', lat: 12.8980, lng: 77.5910, location: 'Arekere Gate', area: 'Bannerghatta Road', severity: 'serious', date: '2024-08-20', time: '18:00', description: 'Signal jump accident at peak hour.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc051', lat: 13.0427, lng: 77.5971, location: 'Nagavara Lake Road', area: 'Hebbal', severity: 'minor', date: '2024-11-19', time: '07:30', description: 'Cyclist hit by car near lake.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc052', lat: 12.9887, lng: 77.7120, location: 'Varthur Junction', area: 'Outer Ring Road', severity: 'serious', date: '2024-11-17', time: '17:30', description: 'Flooded road caused multi-vehicle accident.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc053', lat: 12.9602, lng: 77.5818, location: 'Jayanagar 4th Block', area: 'South Bangalore', severity: 'minor', date: '2024-10-10', time: '09:45', description: 'School zone speed violation.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc054', lat: 12.9515, lng: 77.5520, location: 'Banashankari 3rd Stage', area: 'South Bangalore', severity: 'serious', date: '2024-09-14', time: '20:00', description: 'Night accident at unlit stretch.', source: 'demo', verified: true, reportedBy: null },
    { id: 'acc055', lat: 12.9930, lng: 77.6140, location: 'Shivajinagar Circle', area: 'Central Bangalore', severity: 'minor', date: '2024-08-30', time: '12:30', description: 'Heavy traffic slow collision.', source: 'demo', verified: true, reportedBy: null },
  ];

  // ─── LOCAL STORAGE KEYS ───────────────────────────────────────────────────
  const KEYS = {
    USERS: 'bat_users',
    SESSION: 'bat_session',
    USER_REPORTS: 'bat_user_reports',
  };

  // ─── HELPERS ──────────────────────────────────────────────────────────────
  function generateId() {
    return 'usr_' + Math.random().toString(36).substr(2, 9) + Date.now();
  }

  function getStorage(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
  }

  function setStorage(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  // ─── AUTH ─────────────────────────────────────────────────────────────────
  function register(name, email, password) {
    const users = getStorage(KEYS.USERS);
    if (users.find(u => u.email === email)) {
      return { success: false, error: 'Email already registered.' };
    }
    const user = { id: generateId(), name, email, password, createdAt: new Date().toISOString() };
    users.push(user);
    setStorage(KEYS.USERS, users);
    return { success: true, user: { id: user.id, name: user.name, email: user.email } };
  }

  function login(email, password) {
    const users = getStorage(KEYS.USERS);
    const user = users.find(u => u.email === email && u.password === password);
    if (!user) return { success: false, error: 'Invalid email or password.' };
    const session = { userId: user.id, name: user.name, email: user.email, loginAt: new Date().toISOString() };
    setStorage(KEYS.SESSION, session);
    return { success: true, session };
  }

  function logout() {
    localStorage.removeItem(KEYS.SESSION);
  }

  function getSession() {
    try { return JSON.parse(localStorage.getItem(KEYS.SESSION)); }
    catch { return null; }
  }

  function isLoggedIn() {
    return !!getSession();
  }

  // ─── ACCIDENTS ────────────────────────────────────────────────────────────
  function getAccidents(filters = {}) {
    let data = [...DEMO_ACCIDENTS, ...getStorage(KEYS.USER_REPORTS)];
    if (filters.severity && filters.severity !== 'all') {
      data = data.filter(a => a.severity === filters.severity);
    }
    if (filters.area && filters.area !== 'all') {
      data = data.filter(a => a.area === filters.area);
    }
    if (filters.dateFrom) {
      data = data.filter(a => a.date >= filters.dateFrom);
    }
    if (filters.dateTo) {
      data = data.filter(a => a.date <= filters.dateTo);
    }
    return data;
  }

  function addAccident(accidentData) {
    const session = getSession();
    if (!session) return { success: false, error: 'Not logged in.' };
    const reports = getStorage(KEYS.USER_REPORTS);
    const newReport = {
      id: 'usr_acc_' + Date.now(),
      ...accidentData,
      reportedBy: session.userId,
      reportedByName: session.name,
      source: 'user',
      verified: false,
      status: 'pending',
      submittedAt: new Date().toISOString(),
    };
    reports.push(newReport);
    setStorage(KEYS.USER_REPORTS, reports);
    return { success: true, report: newReport };
  }

  function getUserReports(userId) {
    const reports = getStorage(KEYS.USER_REPORTS);
    return reports.filter(r => r.reportedBy === userId);
  }

  function getHotspots() {
    const data = getAccidents();
    const areaMap = {};
    data.forEach(acc => {
      if (!areaMap[acc.area]) {
        areaMap[acc.area] = { area: acc.area, total: 0, fatal: 0, serious: 0, minor: 0, lat: acc.lat, lng: acc.lng };
      }
      areaMap[acc.area].total++;
      areaMap[acc.area][acc.severity]++;
    });
    return Object.values(areaMap)
      .sort((a, b) => b.total - a.total)
      .map((h, i) => ({ ...h, rank: i + 1 }));
  }

  function getStats() {
    const data = getAccidents();
    return {
      total: data.length,
      fatal: data.filter(a => a.severity === 'fatal').length,
      serious: data.filter(a => a.severity === 'serious').length,
      minor: data.filter(a => a.severity === 'minor').length,
      areas: [...new Set(data.map(a => a.area))].length,
    };
  }

  // ─── EXPORT ───────────────────────────────────────────────────────────────
  window.DB = {
    // Auth
    register,
    login,
    logout,
    getSession,
    isLoggedIn,
    // Data
    getAccidents,
    addAccident,
    getUserReports,
    getHotspots,
    getStats,
  };
})();
