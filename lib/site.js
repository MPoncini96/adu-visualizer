// Site-wide business details in one place: change the brand, domain or phone here.
export const SITE = {
  name: "Valley ADU Studio", // placeholder brand until the builder's name goes in
  url: "https://www.209adus.com",
  phone: "", // e.g. "(209) 555-0100": shows a call button and goes into search data when set
  area: "Lodi to Fresno along Highway 99",
};

// Towns we name for search and in the footer (all within the Hwy 99 service area).
export const CITIES = [
  "Lodi", "Stockton", "Lathrop", "Manteca", "Tracy", "Ripon", "Escalon", "Oakdale",
  "Modesto", "Ceres", "Turlock", "Atwater", "Merced", "Chowchilla", "Madera", "Fresno", "Clovis",
];

export const PROJECT_TYPES = [
  { id: "backyard", label: "Backyard ADU (rental or family)" },
  { id: "garage", label: "Garage conversion" },
  { id: "farm", label: "Farm worker housing" },
  { id: "unsure", label: "Not sure yet" },
];

export const TIMELINES = [
  "As soon as possible",
  "In the next 6 months",
  "6 to 12 months",
  "Just researching",
];
