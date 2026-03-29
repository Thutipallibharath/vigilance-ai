import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import DashboardLayout from './components/DashboardLayout';
import Overview from './pages/Overview';
import LiveMonitor from './pages/LiveMonitor';
import Settings from './pages/Settings';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Simple local storage persistence for demo purposes
  useEffect(() => {
    const auth = localStorage.getItem('vigilance_auth');
    if (auth === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = (status) => {
    setIsAuthenticated(status);
    localStorage.setItem('vigilance_auth', status);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('vigilance_auth');
  };

  return (
    <Router>
      <Routes>
        <Route 
          path="/" 
          element={
            isAuthenticated ? <Navigate to="/dashboard" /> : <Login onLogin={handleLogin} />
          } 
        />
        
        <Route 
          path="/dashboard" 
          element={
            isAuthenticated ? <DashboardLayout onLogout={handleLogout} /> : <Navigate to="/" />
          }
        >
          <Route index element={<Overview />} />
          <Route path="monitor" element={<LiveMonitor />} />
          <Route path="settings" element={<Settings />} />
        </Route>
        
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;
