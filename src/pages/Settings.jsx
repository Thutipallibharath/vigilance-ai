import React from 'react';
import { Save } from 'lucide-react';

function Settings() {
  return (
    <div className="settings-container">
      <h1 className="page-title">System Settings</h1>
      
      <div className="settings-card">
        <h3>Camera Configuration</h3>
        <div className="setting-group">
          <label>Default Camera Resolution</label>
          <select className="form-select">
            <option>640x480 (Performance)</option>
            <option>1280x720 (Standard)</option>
            <option>1920x1080 (HD)</option>
          </select>
        </div>
        
        <h3>AI Threat Detection</h3>
        <div className="setting-group">
          <label>Threat Sensitivity Levels</label>
          <input type="range" min="1" max="10" defaultValue="7" className="form-range" />
          <div className="range-labels">
            <span>Low (Fewer False Positives)</span>
            <span>High (Max Security)</span>
          </div>
        </div>
        
        <div className="setting-group checkbox-group">
          <input type="checkbox" id="audio-alerts" defaultChecked />
          <label htmlFor="audio-alerts">Enable Audio Siren on Emergencies</label>
        </div>
        
        <button className="btn-primary save-btn">
          <Save size={18} /> Save Configurations
        </button>
      </div>
    </div>
  );
}

export default Settings;
