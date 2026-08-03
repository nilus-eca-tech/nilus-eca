const { S3Client, PutObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({ region: process.env.AWS_REGION });

/**
 * تحقق حقيقي من الوصول للحاوية - بدل الدالة الوهمية في الواجهة القديمة
 * التي كانت ترجع "تم الربط بنجاح" بدون أي استدعاء فعلي.
 */
async function verifyBucketAccess() {
  await s3.send(new HeadBucketCommand({ Bucket: process.env.AWS_S3_BUCKET }));
  return { verified: true, bucket: process.env.AWS_S3_BUCKET };
}

/**
 * رفع صورة/بيانات (لقطة الخريطة أو NDVI raster) إلى S3
 * ويرجع رابط موقّع للعرض المؤقت.
 */
async function uploadFieldAsset({ buffer, contentType, keyPrefix, fieldId }) {
  const key = `${keyPrefix}/${fieldId}-${Date.now()}.${contentType === 'image/png' ? 'png' : 'bin'}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
    })
  );

  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key }),
    { expiresIn: 3600 }
  );

  return { key, url };
}

module.exports = { verifyBucketAccess, uploadFieldAsset };
