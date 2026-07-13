window.RECIPE_PACK_SCHEMA = Object.freeze({
  format: "recipe-vault-pack",
  supportedVersions: [1],
  limits: { maxZipBytes: 25 * 1024 * 1024, maxRecipes: 50, maxImageBytes: 8 * 1024 * 1024 },
  imageTypes: ["image/jpeg", "image/png", "image/webp"],
  requiredRecipeFields: ["title", "ingredients", "instructions"]
});
