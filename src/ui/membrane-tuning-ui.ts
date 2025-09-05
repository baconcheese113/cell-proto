/**
 * Live membrane physics parameter tuning UI - Clean Architecture
 * Directly uses MembranePhysicsSystem parameters state channel - no duplicate state!
 */
import { MembranePhysicsSystem, DEFAULT_MEMBRANE_PARAMETERS, type MembraneParameters } from '../membrane/membrane-physics-system';

/**
 * Real-time membrane physics parameter tuning UI
 * Uses ONLY the physics system's state channel - no duplicate parameter state
 */
export class MembraneTuningUI {
  private isVisible: boolean = false;
  private panel!: HTMLDivElement;
  private sliders = new Map<keyof MembraneParameters, HTMLInputElement>();
  private labels = new Map<keyof MembraneParameters, HTMLSpanElement>();
  private parameters: MembraneParameters;

  constructor(membranePhysics: MembranePhysicsSystem) {
    this.parameters = membranePhysics.getParametersStateChannel();
    this.panel = this.createPanel();
  }

  private createPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'membrane-tuning-panel';
    panel.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 320px;
      max-height: 80vh;
      background: rgba(0, 20, 40, 0.95);
      border: 2px solid #00ff88;
      border-radius: 8px;
      padding: 15px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: #cfe;
      z-index: 10000;
      overflow-y: auto;
      backdrop-filter: blur(8px);
      display: none;
    `;

    // Title
    const title = document.createElement('h3');
    title.textContent = '🧬 Membrane Physics Tuning';
    title.style.cssText = `
      margin: 0 0 15px 0;
      color: #00ff88;
      text-align: center;
      font-size: 16px;
    `;
    panel.appendChild(title);

    // Instructions
    const instructions = document.createElement('div');
    instructions.innerHTML = `
      <div style="margin-bottom: 15px; padding: 8px; background: rgba(0, 255, 136, 0.1); border-radius: 4px; font-size: 11px;">
        <strong>Press T to toggle this panel</strong><br>
        Adjust parameters in real-time!<br>
        Lower alpha values = more compliant
      </div>
    `;
    panel.appendChild(instructions);

    // Create parameter sections - ranges adjusted to match current defaults
    this.createSection(panel, '🔗 Edge & Structure', [
      { key: 'alphaEdge', label: 'Edge Compliance', min: 1e-5, max: 1, step: 1e-5, format: 'scientific' },
      { key: 'alphaArea', label: 'Area Compliance', min: 1e-5, max: 1, step: 1e-5, format: 'scientific' },
      { key: 'alphaBend', label: 'Bend Compliance', min: 1e-4, max: 5, step: 1e-5, format: 'scientific' }
    ]);

    this.createSection(panel, '⚙️ Simulation', [
      { key: 'substeps', label: 'Substeps', min: 1, max: 5, step: 1, format: 'integer' },
      { key: 'solverIterations', label: 'Solver Iterations', min: 1, max: 20, step: 1, format: 'integer' },
      { key: 'damping', label: 'Damping', min: 0.95, max: 0.999, step: 0.001, format: 'decimal' },
      { key: 'maxVelocity', label: 'Max Velocity', min: 50, max: 500, step: 10, format: 'integer' }
    ]);

    this.createSection(panel, '💥 Collision & Impact', [
      { key: 'impactImpulseScale', label: 'Impact Scale', min: 10, max: 300, step: 10, format: 'integer' },
      { key: 'impactSofteningFrames', label: 'Softening Frames', min: 1, max: 30, step: 1, format: 'integer' },
      { key: 'impactSofteningFactor', label: 'Softening Factor', min: 1, max: 10, step: 0.1, format: 'decimal' }
    ]);

    this.createSection(panel, '🎯 Endocytosis Special', [
      { key: 'endocytosisCompliance', label: 'Endocytosis Compliance', min: 0.01, max: 1, step: 0.01, format: 'decimal' },
      { key: 'endocytosisRadius', label: 'Effect Radius', min: 10, max: 50, step: 1, format: 'integer' },
      { key: 'endocytosisDepthScale', label: 'Depth Scale', min: 0.05, max: 0.5, step: 0.01, format: 'decimal' }
    ]);

    this.createSection(panel, '⚓ Anchoring', [
      { key: 'centerAnchorCompliance', label: 'Center Anchor', min: 1e-4, max: 1e-1, step: 1e-4, format: 'scientific' }
    ]);

    // Reset button
    const resetButton = document.createElement('button');
    resetButton.textContent = '🔄 Reset to Defaults';
    resetButton.style.cssText = `
      width: 100%;
      padding: 8px;
      margin-top: 15px;
      background: rgba(0, 255, 136, 0.2);
      border: 1px solid #00ff88;
      border-radius: 4px;
      color: #00ff88;
      cursor: pointer;
      font-family: inherit;
    `;
    resetButton.onclick = () => this.resetToDefaults();
    panel.appendChild(resetButton);

    document.body.appendChild(panel);
    return panel;
  }

  private createSection(panel: HTMLDivElement, title: string, params: Array<{
    key: keyof MembraneParameters;
    label: string;
    min: number;
    max: number;
    step: number;
    format: 'integer' | 'decimal' | 'scientific';
  }>): void {
    const section = document.createElement('div');
    section.style.cssText = `
      margin-bottom: 15px;
      padding: 10px;
      background: rgba(0, 255, 136, 0.05);
      border-radius: 4px;
      border-left: 3px solid #00ff88;
    `;

    const sectionTitle = document.createElement('h4');
    sectionTitle.textContent = title;
    sectionTitle.style.cssText = `
      margin: 0 0 10px 0;
      color: #00ff88;
      font-size: 13px;
    `;
    section.appendChild(sectionTitle);

    params.forEach(param => {
      const paramContainer = document.createElement('div');
      paramContainer.style.cssText = 'margin-bottom: 8px;';

      const label = document.createElement('label');
      label.style.cssText = `
        display: block;
        margin-bottom: 3px;
        font-size: 11px;
        color: #88ffbb;
      `;
      
      const valueSpan = document.createElement('span');
      valueSpan.style.cssText = 'float: right; color: #00ff88; font-weight: bold;';
      this.labels.set(param.key, valueSpan);
      
      label.textContent = param.label;
      label.appendChild(valueSpan);
      paramContainer.appendChild(label);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = param.min.toString();
      slider.max = param.max.toString();
      slider.step = param.step.toString();
      slider.value = (this.parameters[param.key] || param.min).toString();
      slider.style.cssText = `
        width: 100%;
        height: 20px;
        background: rgba(0, 255, 136, 0.1);
        border-radius: 10px;
        outline: none;
        -webkit-appearance: none;
      `;

      // Custom slider styling
      const style = document.createElement('style');
      style.textContent = `
        input[type="range"]::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #00ff88;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(0, 255, 136, 0.5);
        }
      `;
      document.head.appendChild(style);

      slider.oninput = () => {
        const value = parseFloat(slider.value);
        // Directly update the physics system's state channel
        this.parameters[param.key] = value;
        this.updateLabel(param.key, value, param.format);
      };

      this.sliders.set(param.key, slider);
      this.updateLabel(param.key, this.parameters[param.key], param.format);
      
      paramContainer.appendChild(slider);
      section.appendChild(paramContainer);
    });

    panel.appendChild(section);
  }

  private updateLabel(key: keyof MembraneParameters, value: number, format: string): void {
    const label = this.labels.get(key);
    if (label) {
      switch (format) {
        case 'integer':
          label.textContent = Math.round(value).toString();
          break;
        case 'scientific':
          label.textContent = value.toExponential(1);
          break;
        case 'decimal':
          label.textContent = value.toFixed(3);
          break;
      }
    }
  }

  private resetToDefaults(): void {
    // Reset state channel to defaults using our centralized const
    this.parameters = {...DEFAULT_MEMBRANE_PARAMETERS};

    // Update sliders to reflect new values
    for (const [key, slider] of this.sliders) {
      const value = this.parameters[key];
      if (value !== undefined) {
        slider.value = value.toString();
        this.updateLabel(key, value, this.getFormatForParameter(key));
      }
    }
  }

  private getFormatForParameter(key: string): string {
    if (key.includes('alpha') || key.includes('Compliance')) return 'scientific';
    if (key.includes('damping') || key.includes('Scale') || key.includes('Factor')) return 'decimal';
    return 'integer';
  }

  public show(): void {
    this.isVisible = true;
    this.panel.style.display = 'block';
  }

  public hide(): void {
    this.isVisible = false;
    this.panel.style.display = 'none';
  }

  public toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  public destroy(): void {
    if (this.panel && this.panel.parentNode) {
      this.panel.parentNode.removeChild(this.panel);
    }
  }
}
