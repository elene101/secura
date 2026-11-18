// ფოტოს ვჭრით კვადრატად და ვამცირებთ 256x256 JPEG-ად, სანამ სერვერზე გავგზავნით
export async function toJpeg(file, size = 256) {
  const bmp = await createImageBitmap(file), s = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas'); c.width = c.height = size;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.85);
}
