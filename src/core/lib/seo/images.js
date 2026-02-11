import { normalizeWhitespace } from "./shared.js";

function countImagesWithoutAlt($) {
  let withoutAlt = 0;
  $("img").each((_, node) => {
    const alt = $(node).attr("alt");
    if (typeof alt !== "string" || normalizeWhitespace(alt).length === 0) {
      withoutAlt += 1;
    }
  });

  return withoutAlt;
}

export { countImagesWithoutAlt };
