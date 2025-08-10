/**
 * Build Palette UI - Milestone 5 Task 2
 * 
 * Simple UI component for selecting construction recipes
 */

import Phaser from "phaser";
import type { ConstructionRecipe } from "./construction-recipes";
import { CONSTRUCTION_RECIPES } from "./construction-recipes";
import type { OrganelleType } from "../organelles/organelle-registry";

export class BuildPaletteUI {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private selectedRecipeId: OrganelleType | null = null;
  private buttons: Map<OrganelleType, Phaser.GameObjects.Container> = new Map();
  private isVisible: boolean = false;
  
  // Store the desired screen position
  private screenOffsetX: number;
  private screenOffsetY: number;
  
  // Milestone 6: Dynamic filtering
  private currentFilter: 'all' | 'membrane' | 'cytosol' = 'all';

  // Callbacks
  public onRecipeSelected?: (recipeId: OrganelleType) => void;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;
    this.screenOffsetX = x;
    this.screenOffsetY = y;
    this.container = scene.add.container(x, y);
    // Remove setScrollFactor(0) to avoid coordinate system conflicts
    this.container.setDepth(100); // Ensure it appears above other UI
    this.createPalette();
    // Initially position the container correctly
    this.updatePosition();
  }

  private createPalette(): void {
    this.rebuildPalette('all');
  }

  /**
   * Milestone 6: Rebuild palette with filtering
   */
  public rebuildPalette(filter: 'all' | 'membrane' | 'cytosol'): void {
    this.currentFilter = filter;
    
    // Clear existing palette
    this.container.removeAll(true);
    this.buttons.clear();
    
    // Get filtered recipes
    const allRecipes = CONSTRUCTION_RECIPES.getAllRecipes();
    const filteredRecipes = allRecipes.filter(recipe => {
      if (filter === 'membrane') return recipe.membraneOnly;
      if (filter === 'cytosol') return recipe.cytosolOnly;
      return true; // 'all' shows everything
    });

    const buttonHeight = 40;
    const buttonWidth = 200;
    const spacing = 5;
    const titleHeight = 25;

    // Background panel
    const panelHeight = Math.max(filteredRecipes.length * (buttonHeight + spacing) + titleHeight + 20, 80);
    const background = this.scene.add.rectangle(0, 0, buttonWidth + 20, panelHeight, 0x333333, 0.9);
    background.setStrokeStyle(2, 0x666666);
    this.container.add(background);

    // Title with filter info
    const filterText = filter === 'all' ? '' : ` (${filter})`;
    const title = this.scene.add.text(0, -panelHeight/2 + titleHeight/2, `Build Menu${filterText}`, {
      fontSize: '14px',
      fontFamily: 'Arial',
      color: '#ffffff'
    });
    title.setOrigin(0.5, 0.5);
    this.container.add(title);

    if (filteredRecipes.length === 0) {
      // Show "no items" message
      const noItemsText = this.scene.add.text(0, 0, `No ${filter} items available`, {
        fontSize: '12px',
        fontFamily: 'Arial',
        color: '#888888'
      });
      noItemsText.setOrigin(0.5, 0.5);
      this.container.add(noItemsText);
    } else {
      // Recipe buttons
      filteredRecipes.forEach((recipe, index) => {
        const buttonY = -panelHeight/2 + titleHeight + 15 + index * (buttonHeight + spacing);
        const button = this.createRecipeButton(recipe, buttonY, buttonWidth, buttonHeight);
        this.container.add(button);
        this.buttons.set(recipe.id, button);
      });
    }
  }

  private createRecipeButton(recipe: ConstructionRecipe, y: number, width: number, height: number): Phaser.GameObjects.Container {
    const button = this.scene.add.container(0, y);

    // Button background
    const bg = this.scene.add.rectangle(0, 0, width, height, 0x444444);
    bg.setStrokeStyle(1, 0x666666);
    bg.setInteractive();
    button.add(bg);

    // Recipe name
    const nameText = this.scene.add.text(-width/2 + 10, -8, recipe.label, {
      fontSize: '12px',
      fontFamily: 'Arial',
      color: '#ffffff'
    });
    nameText.setOrigin(0, 0.5);
    button.add(nameText);

    // Cost summary
    const costs = Object.entries(recipe.buildCost)
      .map(([species, amount]) => `${species}:${amount}`)
      .join(', ');
    const costText = this.scene.add.text(-width/2 + 10, 8, costs, {
      fontSize: '10px',
      fontFamily: 'Arial',
      color: '#cccccc'
    });
    costText.setOrigin(0, 0.5);
    button.add(costText);

    // Click handler
    bg.on('pointerdown', () => {
      console.log(`Button clicked for recipe: ${recipe.id}`);
      this.selectRecipe(recipe.id);
    });

    // Hover effects
    bg.on('pointerover', () => {
      console.log(`Hovering over recipe: ${recipe.id}`);
      bg.setFillStyle(0x555555);
    });

    bg.on('pointerout', () => {
      const isSelected = this.selectedRecipeId === recipe.id;
      bg.setFillStyle(isSelected ? 0x666666 : 0x444444);
    });

    return button;
  }

  private selectRecipe(recipeId: OrganelleType): void {
    // Update visual selection
    if (this.selectedRecipeId) {
      const oldButton = this.buttons.get(this.selectedRecipeId);
      if (oldButton) {
        const oldBg = oldButton.list[0] as Phaser.GameObjects.Rectangle;
        oldBg.setFillStyle(0x444444);
      }
    }

    this.selectedRecipeId = recipeId;
    const newButton = this.buttons.get(recipeId);
    if (newButton) {
      const newBg = newButton.list[0] as Phaser.GameObjects.Rectangle;
      newBg.setFillStyle(0x666666);
    }

    // Notify callback
    if (this.onRecipeSelected) {
      this.onRecipeSelected(recipeId);
    }

    console.log(`Selected recipe: ${recipeId}`);
  }

  public getSelectedRecipe(): OrganelleType | null {
    return this.selectedRecipeId;
  }

  public show(): void {
    this.isVisible = true;
    
    // Position relative to current camera position using the specified screen offset
    const camera = this.scene.cameras.main;
    const screenX = camera.scrollX + this.screenOffsetX;
    
    // Calculate panel height to adjust Y position so top of panel is at screenOffsetY
    const panelHeight = this.calculatePanelHeight();
    const screenY = camera.scrollY + this.screenOffsetY + panelHeight / 2;
    
    this.container.setPosition(screenX, screenY);
    this.container.setVisible(true);
  }

  public hide(): void {
    this.isVisible = false;
    this.container.setVisible(false);
  }

  public toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  public getIsVisible(): boolean {
    return this.isVisible;
  }

  public updatePosition(): void {
    // Update position to stay in fixed screen location if visible
    if (this.isVisible) {
      const camera = this.scene.cameras.main;
      const screenX = camera.scrollX + this.screenOffsetX;
      
      // Calculate panel height to adjust Y position so top of panel is at screenOffsetY
      const panelHeight = this.calculatePanelHeight();
      const screenY = camera.scrollY + this.screenOffsetY + panelHeight / 2;
      
      this.container.setPosition(screenX, screenY);
    }
  }

  private calculatePanelHeight(): number {
    const allRecipes = CONSTRUCTION_RECIPES.getAllRecipes();
    const filteredRecipes = allRecipes.filter(recipe => {
      if (this.currentFilter === 'membrane') return recipe.membraneOnly;
      if (this.currentFilter === 'cytosol') return recipe.cytosolOnly;
      return true; // 'all' shows everything
    });

    const buttonHeight = 40;
    const spacing = 5;
    const titleHeight = 25;
    
    return Math.max(filteredRecipes.length * (buttonHeight + spacing) + titleHeight + 20, 80);
  }

  public setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  public destroy(): void {
    this.container.destroy();
  }
}
