/**
 * Motility Telemetry System v2
 * 
 * Comprehensive logging and analytics for motility mode performance.
 * Tracks user behavior, mode effectiveness, and provides balancing insights.
 */

export interface TelemetryEvent {
  timestamp: number;
  eventType: 'mode_switch' | 'action_trigger' | 'skill_usage' | 'performance_metric' | 'terrain_interaction';
  data: Record<string, any>;
}

export interface SessionMetrics {
  sessionId: string;
  startTime: number;
  endTime?: number;
  totalModeUsage: Record<string, number>; // mode ID -> seconds used
  actionCounts: Record<string, number>;   // action type -> count
  performanceScores: number[];           // course completion scores
  terrainInteractions: Record<string, number>; // terrain type -> interaction count
}

export interface BalancingInsights {
  modeUsageBalance: Record<string, number>; // how often each mode is used (0-1)
  actionEffectiveness: Record<string, number>; // action success rates
  terrainAdvantages: Record<string, Record<string, number>>; // mode -> terrain -> advantage score
  difficultyMetrics: {
    averageCompletionTime: number;
    averageScore: number;
    modeDistribution: Record<string, number>;
  };
}

export class MotilityTelemetry {
  private events: TelemetryEvent[] = [];
  private currentSession: SessionMetrics;
  private sessionHistory: SessionMetrics[] = [];
  
  // Real-time tracking
  private currentModeStart: number = 0;
  private currentMode: string = 'amoeboid';
  
  constructor() {
    this.currentSession = this.createNewSession();
  }
  
  private createNewSession(): SessionMetrics {
    return {
      sessionId: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      startTime: Date.now(),
      totalModeUsage: {
        'amoeboid': 0,
        'blebbing': 0,
        'mesenchymal': 0
      },
      actionCounts: {},
      performanceScores: [],
      terrainInteractions: {}
    };
  }
  
  // Event logging
  logEvent(eventType: TelemetryEvent['eventType'], data: Record<string, any>): void {
    const event: TelemetryEvent = {
      timestamp: Date.now(),
      eventType,
      data
    };
    
    this.events.push(event);
    this.updateSessionMetrics(event);
    
    // Keep events manageable (last 1000 events)
    if (this.events.length > 1000) {
      this.events = this.events.slice(-1000);
    }
  }
  
  private updateSessionMetrics(event: TelemetryEvent): void {
    const now = Date.now();
    
    switch (event.eventType) {
      case 'mode_switch':
        // Track previous mode usage
        if (this.currentModeStart > 0) {
          const duration = (now - this.currentModeStart) / 1000;
          this.currentSession.totalModeUsage[this.currentMode] += duration;
        }
        
        // Switch to new mode
        this.currentMode = event.data['newMode'];
        this.currentModeStart = now;
        break;
        
      case 'action_trigger':
        const action = event.data['actionType'];
        this.currentSession.actionCounts[action] = (this.currentSession.actionCounts[action] || 0) + 1;
        break;
        
      case 'terrain_interaction':
        const terrain = event.data['terrainType'];
        this.currentSession.terrainInteractions[terrain] = (this.currentSession.terrainInteractions[terrain] || 0) + 1;
        break;
        
      case 'performance_metric':
        if (event.data['type'] === 'course_completion') {
          this.currentSession.performanceScores.push(event.data['score']);
        }
        break;
    }
  }
  
  // Session management
  endSession(): void {
    // Finalize current mode usage
    if (this.currentModeStart > 0) {
      const duration = (Date.now() - this.currentModeStart) / 1000;
      this.currentSession.totalModeUsage[this.currentMode] += duration;
    }
    
    this.currentSession.endTime = Date.now();
    this.sessionHistory.push({ ...this.currentSession });
    this.currentSession = this.createNewSession();
    
    // Keep session history manageable
    if (this.sessionHistory.length > 50) {
      this.sessionHistory = this.sessionHistory.slice(-50);
    }
  }
  
  getCurrentSession(): SessionMetrics {
    return { ...this.currentSession };
  }
  
  getSessionHistory(): SessionMetrics[] {
    return [...this.sessionHistory];
  }
  
  // Analytics and insights
  generateBalancingInsights(): BalancingInsights {
    const allSessions = [...this.sessionHistory];
    if (this.currentSession.totalModeUsage) {
      allSessions.push(this.currentSession);
    }
    
    if (allSessions.length === 0) {
      return this.getDefaultInsights();
    }
    
    return {
      modeUsageBalance: this.calculateModeUsageBalance(allSessions),
      actionEffectiveness: this.calculateActionEffectiveness(allSessions),
      terrainAdvantages: this.calculateTerrainAdvantages(allSessions),
      difficultyMetrics: this.calculateDifficultyMetrics(allSessions)
    };
  }
  
  private calculateModeUsageBalance(sessions: SessionMetrics[]): Record<string, number> {
    const totalUsage: Record<string, number> = {};
    let grandTotal = 0;
    
    sessions.forEach(session => {
      Object.entries(session.totalModeUsage).forEach(([mode, usage]) => {
        totalUsage[mode] = (totalUsage[mode] || 0) + usage;
        grandTotal += usage;
      });
    });
    
    // Normalize to percentages
    const balance: Record<string, number> = {};
    Object.entries(totalUsage).forEach(([mode, usage]) => {
      balance[mode] = grandTotal > 0 ? usage / grandTotal : 0.33;
    });
    
    return balance;
  }
  
  private calculateActionEffectiveness(sessions: SessionMetrics[]): Record<string, number> {
    const actionCounts: Record<string, number> = {};
    const successfulActions: Record<string, number> = {};
    
    sessions.forEach(session => {
      Object.entries(session.actionCounts).forEach(([action, count]) => {
        actionCounts[action] = (actionCounts[action] || 0) + count;
      });
      
      // Estimate success based on performance scores
      const avgScore = session.performanceScores.length > 0 
        ? session.performanceScores.reduce((a, b) => a + b, 0) / session.performanceScores.length
        : 0;
      
      Object.entries(session.actionCounts).forEach(([action, count]) => {
        // Higher scores suggest more effective action usage
        const effectiveness = Math.min(1.0, avgScore / 2.0); // Assume 2-star = 100% effectiveness
        successfulActions[action] = (successfulActions[action] || 0) + count * effectiveness;
      });
    });
    
    const effectiveness: Record<string, number> = {};
    Object.entries(actionCounts).forEach(([action, count]) => {
      effectiveness[action] = count > 0 ? (successfulActions[action] || 0) / count : 0;
    });
    
    return effectiveness;
  }
  
  private calculateTerrainAdvantages(_sessions: SessionMetrics[]): Record<string, Record<string, number>> {
    // This would require more detailed tracking of mode performance on specific terrains
    // For now, return estimated advantages based on design intentions
    return {
      'amoeboid': {
        'SOFT': 1.2,
        'FIRM': 1.0,
        'ECM': 0.8,
        'LOOSE': 0.9
      },
      'blebbing': {
        'SOFT': 0.9,
        'FIRM': 0.8,
        'ECM': 0.7,
        'LOOSE': 1.3
      },
      'mesenchymal': {
        'SOFT': 0.7,
        'FIRM': 1.0,
        'ECM': 1.4,
        'LOOSE': 0.8
      }
    };
  }
  
  private calculateDifficultyMetrics(sessions: SessionMetrics[]): BalancingInsights['difficultyMetrics'] {
    const allScores = sessions.flatMap(s => s.performanceScores);
    const allTimes = sessions.map(s => s.endTime && s.startTime ? (s.endTime - s.startTime) / 1000 : 0).filter(t => t > 0);
    
    const totalUsage: Record<string, number> = {};
    let grandTotal = 0;
    
    sessions.forEach(session => {
      Object.entries(session.totalModeUsage).forEach(([mode, usage]) => {
        totalUsage[mode] = (totalUsage[mode] || 0) + usage;
        grandTotal += usage;
      });
    });
    
    const modeDistribution: Record<string, number> = {};
    Object.entries(totalUsage).forEach(([mode, usage]) => {
      modeDistribution[mode] = grandTotal > 0 ? usage / grandTotal : 0.33;
    });
    
    return {
      averageCompletionTime: allTimes.length > 0 ? allTimes.reduce((a, b) => a + b, 0) / allTimes.length : 0,
      averageScore: allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0,
      modeDistribution
    };
  }
  
  private getDefaultInsights(): BalancingInsights {
    return {
      modeUsageBalance: {
        'amoeboid': 0.33,
        'blebbing': 0.33,
        'mesenchymal': 0.33
      },
      actionEffectiveness: {},
      terrainAdvantages: {
        'amoeboid': { 'SOFT': 1.2, 'FIRM': 1.0, 'ECM': 0.8 },
        'blebbing': { 'SOFT': 0.9, 'FIRM': 0.8, 'ECM': 0.7 },
        'mesenchymal': { 'SOFT': 0.7, 'FIRM': 1.0, 'ECM': 1.4 }
      },
      difficultyMetrics: {
        averageCompletionTime: 0,
        averageScore: 0,
        modeDistribution: { 'amoeboid': 0.33, 'blebbing': 0.33, 'mesenchymal': 0.33 }
      }
    };
  }
  
  // Preset generation
  generateBalancedPresets(): Record<string, any> {
    const insights = this.generateBalancingInsights();
    
    return {
      'balanced': this.createBalancedPreset(insights),
      'challenge': this.createChallengePreset(insights),
      'beginner': this.createBeginnerPreset(insights)
    };
  }
  
  private createBalancedPreset(insights: BalancingInsights): any {
    // Adjust parameters based on usage patterns
    const usage = insights.modeUsageBalance;
    
    return {
      name: "Balanced",
      description: "Auto-balanced based on player usage data",
      adjustments: {
        // Boost under-used modes slightly
        amoeboid: {
          speedBoost: usage['amoeboid'] < 0.3 ? 1.1 : 1.0,
          energyEfficiency: usage['amoeboid'] < 0.3 ? 1.1 : 1.0
        },
        blebbing: {
          speedBoost: usage['blebbing'] < 0.3 ? 1.1 : 1.0,
          energyEfficiency: usage['blebbing'] < 0.3 ? 1.1 : 1.0
        },
        mesenchymal: {
          speedBoost: usage['mesenchymal'] < 0.3 ? 1.1 : 1.0,
          energyEfficiency: usage['mesenchymal'] < 0.3 ? 1.1 : 1.0
        }
      }
    };
  }
  
  private createChallengePreset(_insights: BalancingInsights): any {
    return {
      name: "Challenge",
      description: "Increased difficulty for experienced players",
      adjustments: {
        global: {
          energyCostMultiplier: 1.3,
          speedReduction: 0.9,
          precisionRequired: 1.2
        }
      }
    };
  }
  
  private createBeginnerPreset(_insights: BalancingInsights): any {
    return {
      name: "Beginner",
      description: "Forgiving settings for new players",
      adjustments: {
        global: {
          energyCostMultiplier: 0.8,
          speedBoost: 1.1,
          precisionTolerance: 1.3
        }
      }
    };
  }
  
  // Export/import for persistence
  exportTelemetryData(): string {
    return JSON.stringify({
      events: this.events,
      currentSession: this.currentSession,
      sessionHistory: this.sessionHistory
    });
  }
  
  importTelemetryData(data: string): boolean {
    try {
      const parsed = JSON.parse(data);
      this.events = parsed.events || [];
      this.currentSession = parsed.currentSession || this.createNewSession();
      this.sessionHistory = parsed.sessionHistory || [];
      return true;
    } catch (error) {
      console.error('Failed to import telemetry data:', error);
      return false;
    }
  }
}
