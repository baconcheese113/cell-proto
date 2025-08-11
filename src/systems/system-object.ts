// systems/system-object.ts
export class SystemObject extends Phaser.GameObjects.GameObject {
  private _enabled = true
  
  constructor(scene: Phaser.Scene, override name: string, private fn: (dt: number) => void) {
    super(scene, name)
    scene.add.existing(this) // registers into UpdateList -> preUpdate called
  }
  
  setEnabled(v: boolean) { this._enabled = v }
  
  preUpdate(_time: number, delta: number) { 
    if (this._enabled) this.fn(delta / 1000) 
  }
  
  override destroy(fromScene?: boolean): void { 
    super.destroy(fromScene) 
  }
}
