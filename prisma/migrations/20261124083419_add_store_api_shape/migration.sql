-- AlterTable
ALTER TABLE "StoreConnection" ADD COLUMN     "imageField" TEXT NOT NULL DEFAULT 'images',
ADD COLUMN     "limitParam" TEXT DEFAULT 'take',
ADD COLUMN     "nameField" TEXT NOT NULL DEFAULT 'name',
ADD COLUMN     "priceField" TEXT NOT NULL DEFAULT 'price',
ADD COLUMN     "productsPath" TEXT NOT NULL DEFAULT '/products',
ADD COLUMN     "responsePath" TEXT DEFAULT 'data',
ADD COLUMN     "searchParam" TEXT DEFAULT 'search',
ADD COLUMN     "stockField" TEXT NOT NULL DEFAULT 'stock';
