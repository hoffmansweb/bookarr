// Decide whether a scraped URL is plausibly a photo of the author, rather than a site
// graphic (Amazon's "Follow this author" store banner, sprites, logos) or a
// "no photo" placeholder.
const BAD_PATTERNS = [
  /m\.media-amazon\.com\/images\/G\//i,       // Amazon global site assets (banners, badges, sprites)
  /images-(na|eu|fe)\.ssl-images-amazon\.com\/images\/G\//i,
  /banner|sprite|follow|logo|placeholder|default[-_]?avatar|transparent-pixel|grey-pixel/i,
  /nophoto|no-photo|no_photo|member_photo|user_default/i, // Goodreads placeholders
  /covers\.openlibrary\.org\/a\/id\/-1/i,
  /\.svg(\?|$)/i,
  /^data:/i
];

const isLikelyAuthorPhoto = (url) => {
  if (!url || typeof url !== 'string') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  return !BAD_PATTERNS.some(re => re.test(url));
};

module.exports = { isLikelyAuthorPhoto };
