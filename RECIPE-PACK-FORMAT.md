# Recipe Vault Pack Format v1

A recipe pack is a ZIP containing `manifest.json` at the ZIP root plus optional images.

Required manifest fields:
- `format`: `recipe-vault-pack`
- `version`: `1`
- `recipes`: array

Required per recipe:
- `title`
- `ingredients`: ordered string array
- `instructions`: ordered string array

Optional per recipe:
`description`, `prepTime`, `cookTime`, `totalTime`, `servings`, `protein`, `mealType`, `cuisine`, `collections`, `tags`, `notes`, `nutrition`, `sourceName`, `sourceUrl`, `image`.

Unknown fields are ignored. Images may be JPG, PNG, or WebP and must use a safe relative path such as `images/dinner.jpg`.
