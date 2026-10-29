// Interior floor plans, one JSON per plan (see each file's "note" for the coordinate system).
import pocket from "./pocket.json";
import apricot from "./apricot.json";
import cherry from "./cherry.json";
import peach from "./peach.json";
import plum from "./plum.json";
import walnut from "./walnut.json";
import olive from "./olive.json";
import almond from "./almond.json";
import pistachio from "./pistachio.json";
import fig from "./fig.json";

export const FLOORPLANS = { pocket, apricot, cherry, peach, plum, walnut, olive, almond, pistachio, fig };
export const floorPlanFor = (modelId) => FLOORPLANS[modelId] || null;
