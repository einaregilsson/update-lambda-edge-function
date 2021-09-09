#!/usr/bin/env node
// Author: Einar Egilsson, https://github.com/einaregilsson/update-lambda-edge-function

const aws = require('aws-sdk');

const env = process.env;
const IS_GITHUB_ACTION = !!process.env.GITHUB_ACTIONS;

if (!IS_GITHUB_ACTION) {
    if (process.argv.length === 5) {
        [_, _, env.CLOUDFRONT_DISTRIBUTION_ID, env.INPUT_FUNCTION_NAME, env.INPUT_NEW_VERSION_NR] = process.argv;
    } else {
        console.log('\n\n*** Update Lambda@Edge function version nr ***');
        console.log('\nUpdate the version of a Lambda@Edge function used in a Cloudfront Distribution');
        console.log('\nhttps://github.com/einaregilsson/update-lambda-edge-function\n');
        console.log('  Usage: update-lambda-edge-function.js <cloudfront-distribution-id> <function-name> <new-version-nr>\n');
        console.log('Environment variables AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be defined for the program to work.');
        console.log('\nThe program will attempt to find any usages of function <function-name> in the distribution, and update them to use version <new-version-nr>.\n');
        process.exit(1);
    }
}

function fail(error) {
    if (IS_GITHUB_ACTION) {
        console.log(`::error::ERROR: ${error}\n`);
    } else {
        console.error(`ERROR: ${error}\n`);
    }
    process.exit(1);
}

function strip(val) {
    //Strip leadig or trailing whitespace
    return (val || '').replace(/^\s*|\s*$/g, '');
}

//Process input params

let awsAccessKey = env.INPUT_AWS_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey = env.INPUT_AWS_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY;

if (!awsAccessKey || !awsSecretAccessKey) {
    fail('AWS access key id or secret access key are not configured correctly.');    
}

var funcName = strip(env.INPUT_FUNCTION_NAME),
    newFuncVersion = strip(env.INPUT_NEW_VERSION_NR),
    distributionId = strip(env.CLOUDFRONT_DISTRIBUTION_ID);

if (!funcName.match(/^[a-zA-Z]\w+$/)) {
    fail(`Invalid function name "${funcName}". Should only be a simple name, not a full ARN, or anything with special characters.`);
} else if (!newFuncVersion.match(/^\d+$/)) {
    fail(`Invalid version nr: "${newFuncVersion}". Must be a normal positive number`);
} else if (!distributionId.match(/^\w+$/)) {
    fail(`Invalid distribution id: ${distributionId}`);
} 

const isDryRun = !!strip(process.env.DRY_RUN).match(/true|1/i); 

if (isDryRun) {
    console.log('***** THIS IS A DRY RUN. THE DISTRIBUTION WILL NOT BE UPDATED, WE WILL ONLY SHOW HOW THE CONFIG WOULD BE CHANGED.');
}


const cloudfront = new aws.CloudFront({credentials: new aws.Credentials(env.AWS_ACCESS_KEY_ID, env.AWS_SECRET_ACCESS_KEY)});
let prevArnWithoutVersion;


cloudfront.getDistributionConfig({Id: distributionId}, function(err, data) {

    if (err) {
        fail(err);
    }

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
                    fail(`ERROR: Two possible matches for func name "${funcName}". Both "${prevArnWithoutVersion}" and "${arnWithoutVersion}" match, aborting!`)
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
        fail(`Found no Lambda@Edge function matching the name "${funcName}" in distribution ${distributionId}`);
    }

    let params = {
        Id: distributionId,
        DistributionConfig: distributionConfig,
        IfMatch: etag
    };

    if (isDryRun) {
        console.log('The updated distribution configuration that we would send to Cloudfront in a real run looks like this:\n');
        console.log(JSON.stringify(distributionConfig, null, 2));
        console.log('\n\n***** DRY RUN FINISHED. RUN THE ACTION AGAIN WITHOUT SETTING dry_run=true TO ACTUALLY UPDATE YOUR DISTRIBUTION.');
        process.exit(0);
    }

    console.log('About to update distribution...\n');

    cloudfront.updateDistribution(params, function(err, result) {
        if (err) {
            fail(err);
        }

        console.log('Result of distribution update:');
        console.log(JSON.stringify(data, null, 2));

        console.log('\n\nUpdate was successful. It may take a few minutes for the changes to the distribution to be fully deployed.');
    });
});