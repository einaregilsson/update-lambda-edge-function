
const aws = require('aws-sdk');
var cloudfront = new aws.CloudFront();

var funcName = 'CountryCodeApi';
var newFuncVersion = 2;
var distributionId = 'EFMCTQ80BRW5M';
distributionId = 'E3PP6IZJ741VCH';
let prevArnWithoutVersion;
cloudfront.getDistributionConfig({Id: distributionId}, function(err, data) {
    console.log('GOT ' + JSON.stringify(data, null, 2));

    let etag = data.ETag;

    let distributionConfig = data.DistributionConfig;

    let cacheBehaviours = [distributionConfig.DefaultCacheBehavior];
    if (distributionConfig.CacheBehaviors && distributionConfig.CacheBehaviors.Items) {
        cacheBehaviours.push(...distributionConfig.CacheBehaviors.Items);
    }

    let possibleCName = '';
    if (distributionConfig.Aliases && distributionConfig.Aliases.Items) {
        possibleCName = ` (${distributionConfig.Aliases.Items[0]})`; 
    }

    console.log(`Got configuration for distribution ${distributionId}${possibleCName}, ETag is ${etag}`);

    let countUpdated = 0;
    console.log(`Distribution has ${cacheBehaviours.length} cache behaviours`);
    let rx = new RegExp(`:function:${funcName}:\\d+$`);

    for (let cb of cacheBehaviours) {
        for (let func of cb.LambdaFunctionAssociations.Items) {
            
            if (func.LambdaFunctionARN.match(rx)) {
                
                console.log(`Found ARN matching function name ${funcName}: ${func.LambdaFunctionARN}`);
                let arnWithoutVersion = func.LambdaFunctionARN.replace(/:\d+$/, '');

                if (prevArnWithoutVersion && prevArnWithoutVersion !== arnWithoutVersion) {
                    throw new Error(`ERROR: Two possible matches for func name "${funcName}". Both "${prevArnWithoutVersion}" and "${arnWithoutVersion}" match, aborting!"`);
                } 
                prevFuncWithoutArn = arnWithoutVersion;
                //Replace the version nr at the end
                let fullNewFunctionArn = arnWithoutVersion + ':' + newFuncVersion;
                console.log(`Updating function arn on path ${cb.PathPattern} from \n\n   ${func.LambdaFunctionARN} \n\nto \n\n   ${fullNewFunctionArn}\n`);
                func.LambdaFunctionARN = fullNewFunctionArn;
                countUpdated++;
            }
        }
    }

    if (countUpdated === 0) {
        console.error(`Found no Lambda@Edge function matching the name "${funcName}" in distribution ${distributionId}`);
        throw new Error('sdf');
    }

    let params = {
        Id: distributionId,
        DistributionConfig: distributionConfig,
        IfMatch: etag
    };

    cloudfront.updateDistribution(params, function(err, result) {
        console.log('ERR: '  + err);

        console.log('DATA :' + result);
        console.log('DATA2: ' + JSON.stringify(result, null, 2));
    });
});