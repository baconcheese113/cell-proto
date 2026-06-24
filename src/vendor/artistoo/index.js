// Artistoo (https://github.com/ingewortel/artistoo) — vendored ESM source, MIT licensed.
// See ./LICENSE. Copyright (c) 2019 Johannes Textor & Inge Wortel.
//
// This is a FORK: we vendor Artistoo's native-ESM `src/` tree so we can modify
// individual constraints/behaviours (compartment cohesion + tearing, leakage,
// directed-transport, networking hooks) per the project plan.
//
// Artistoo itself is NOT published to npm and ships only IIFE + CJS builds (no
// ESM artifact). The `src/` tree, however, is authored as native ES modules. The
// only Node-coupled file is `Canvas.js` (and `simulation/Simulation.js`, which
// imports it); both are omitted here because we render through Phaser, not
// Artistoo's own canvas. This entry therefore re-exports only the browser-safe,
// headless simulation core — mirroring Artistoo's own `app/index.js` minus those
// two files.

import CA from "./models/CA.js";
import CPM from "./models/CPM.js";
import CPMEvol from "./models/CPMEvol.js";
import GridBasedModel from "./models/GridBasedModel.js";

import Cell from "./cells/Cell.js";
import Divider from "./cells/Divider.js";

import Stat from "./stats/Stat.js";
import PixelsByCell from "./stats/PixelsByCell.js";
import BorderPixelsByCell from "./stats/BorderPixelsByCell.js";
import CentroidsWithTorusCorrection from "./stats/CentroidsWithTorusCorrection.js";
import Centroids from "./stats/Centroids.js";
import CellNeighborList from "./stats/CellNeighborList.js";
import ConnectedComponentsByCell from "./stats/ConnectedComponentsByCell.js";
import Connectedness from "./stats/Connectedness.js";

import Grid from "./grid/Grid.js";
import Grid2D from "./grid/Grid2D.js";
import Grid3D from "./grid/Grid3D.js";
import GridManipulator from "./grid/GridManipulator.js";
import CoarseGrid from "./grid/CoarseGrid.js";

import ParameterChecker from "./hamiltonian/ParameterChecker.js";

import SoftConstraint from "./hamiltonian/SoftConstraint.js";
import Adhesion from "./hamiltonian/Adhesion.js";
import VolumeConstraint from "./hamiltonian/VolumeConstraint.js";
import PerimeterConstraint from "./hamiltonian/PerimeterConstraint.js";
import ActivityConstraint from "./hamiltonian/ActivityConstraint.js";
import ActivityMultiBackground from "./hamiltonian/ActivityMultiBackground.js";
import PersistenceConstraint from "./hamiltonian/PersistenceConstraint.js";
import PreferredDirectionConstraint from "./hamiltonian/PreferredDirectionConstraint.js";
import ChemotaxisConstraint from "./hamiltonian/ChemotaxisConstraint.js";
import AttractionPointConstraint from "./hamiltonian/AttractionPointConstraint.js";
import ConnectivityConstraint from "./hamiltonian/ConnectivityConstraint.js";
import SoftConnectivityConstraint from "./hamiltonian/SoftConnectivityConstraint.js";
import LocalConnectivityConstraint from "./hamiltonian/LocalConnectivityConstraint.js";
import SoftLocalConnectivityConstraint from "./hamiltonian/SoftLocalConnectivityConstraint.js";

import HardConstraint from "./hamiltonian/HardConstraint.js";
import HardVolumeRangeConstraint from "./hamiltonian/HardVolumeRangeConstraint.js";
import BarrierConstraint from "./hamiltonian/BarrierConstraint.js";
import BorderConstraint from "./hamiltonian/BorderConstraint.js";

export {
	CA,
	CPM,
	CPMEvol,
	GridBasedModel,
	Cell,
	Divider,
	Stat,
	PixelsByCell,
	BorderPixelsByCell,
	CentroidsWithTorusCorrection,
	Centroids,
	CellNeighborList,
	ConnectedComponentsByCell,
	Connectedness,
	Grid,
	Grid2D,
	Grid3D,
	GridManipulator,
	CoarseGrid,
	ParameterChecker,
	SoftConstraint,
	Adhesion,
	VolumeConstraint,
	PerimeterConstraint,
	ActivityConstraint,
	ActivityMultiBackground,
	PersistenceConstraint,
	PreferredDirectionConstraint,
	ChemotaxisConstraint,
	AttractionPointConstraint,
	ConnectivityConstraint,
	SoftConnectivityConstraint,
	LocalConnectivityConstraint,
	SoftLocalConnectivityConstraint,
	HardConstraint,
	HardVolumeRangeConstraint,
	BarrierConstraint,
	BorderConstraint,
};
