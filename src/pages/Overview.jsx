import React from 'react';
import { Users, AlertTriangle, ShieldCheck, Activity } from 'lucide-react';

function Overview() {
  return (
    <div className="overview-container">
      <h1 className="page-title">System Overview</h1>
      
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon bg-blue">
            <ShieldCheck size={24} color="#fff" />
          </div>
          <div className="stat-info">
            <h3>System Status</h3>
            <p className="status-good">Secure</p>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon bg-green">
            <Activity size={24} color="#fff" />
          </div>
          <div className="stat-info">
            <h3>Uptime</h3>
            <p>99.9%</p>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon bg-yellow">
            <Users size={24} color="#fff" />
          </div>
          <div className="stat-info">
            <h3>Active Subjects</h3>
            <p>0 Detected</p>
          </div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon bg-red">
            <AlertTriangle size={24} color="#fff" />
          </div>
          <div className="stat-info">
            <h3>Recent Alerts</h3>
            <p>0 Today</p>
          </div>
        </div>
      </div>

      <div className="recent-activity-section">
        <h2>Recent Activity Log</h2>
        <div className="activity-card">
          <p className="no-activity-text">All quiet on the front. Monitoring active.</p>
        </div>
      </div>
    </div>
  );
}

export default Overview;
