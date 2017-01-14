/**
 * Created by LC on 2015/9/29.
 */


/**
 * Created by lenovo on 2014/9/14.
 */

    //这个js用的是redis 6号数据库， mongo-weiboSina3     而且读的json文件名为：sites_users_json.txt

var iconv = require('iconv-lite'); //字符集转换
var mongo = require('mongodb');
var monk = require('monk');
var redis = require('redis')
var Request = require('request');
var fs = require('fs')
var RsaEncrypt = require("./rsa").RSAKey;
var async = require('async');
var cheerio = require('cheerio');
var cookieColl = Request.jar();
var request = Request.defaults({jar: cookieColl});

var connection_string = '127.0.0.1:27017/weiboSina3';
var db = monk(connection_string);
var redisclient = redis.createClient()
redisclient.select(6, function(){})

var userCnt = 0;
var allSites = new Array()

function saveUser(user, total){
    var userColl = db.get("users");
    userColl.insert(user);
    userCnt++;
    log("save mongo - id:"+ user.id +" total:"+total + " now:" + userCnt)
}

function getAllUserId(weiboId, userId, thisSite){
    var thisIdNo = 0;
    var allIds = new Array()

    allIds.push(userId)

    var weiboColl = db.get(weiboId)
    var all = weiboColl.find({}, (function(err, docs) {
        if(err){
            log("mongodb fail to find():"+err)
        }
        docs.forEach(function(item, index){
            allIds.push(item.uid);
        });
        log("total of this weisite:"+allIds.length+"   "+weiboId);
        setTimeout(function(){getUserSite(allIds, thisIdNo, thisSite)}, 500)
    }));

}


function getJsonObj(body){
    var start = body.indexOf("{");
    var end = body.lastIndexOf("}");
    var jsonStr = body.substr(start,end -start + 1);
    var responseJson = JSON.parse(jsonStr);
    return responseJson;
}


function getUserSite(allIds, oldIdNo, oldSite){
        var userId = allIds[oldIdNo]
        var thisIdNo = oldIdNo
        var thisSiteIndex = oldSite
        redisclient.sismember("users", userId, function(value,err){
            userId = allIds[oldIdNo]
            if(err){//如果之前爬过这个uid
                userCnt++;
                console.log("duplicate users:"+userId+" total:"+allIds.length+" now:"+userCnt+" no:"+oldIdNo);
                thisIdNo = oldIdNo + 1
                if(thisIdNo == allIds.length){
                    thisSiteIndex = oldSite + 1
                    if(thisSiteIndex == allSites.length){
                        log("all site finished")
                    }else {
                        log("finish one site")
                        userCnt = 0;
                        var userId = allSites[thisSiteIndex].split('\/')[3]
                        var weiboId = allSites[thisSiteIndex].split('\/')[4]
                        getAllUserId(weiboId, userId, thisSiteIndex)
                    }
                }
                else {
                    setTimeout(function () {getUserSite(allIds, thisIdNo, thisSiteIndex)}, 10);

                }
            }
            else{ //如果之前没爬过这个uid
                redisclient.sismember("nousers", userId, function(value2,err2){
                    userId = allIds[oldIdNo]
                    if(err2) {//如果之前爬过这个uid且属于nouser
                        userCnt++;
                        console.log("duplicate no-users:"+userId+" total:"+allIds.length+" now:"+userCnt);
                        thisIdNo = oldIdNo + 1
                        if(thisIdNo == allIds.length){
                            thisSiteIndex = oldIdNo + 1
                            if(thisSiteIndex == allSites.length){
                                log("all site finished")
                            }else {
                                log("finish one site")
                                userCnt = 0;
                                var userId = allSites[thisSiteIndex].split('\/')[3]
                                var weiboId = allSites[thisSiteIndex].split('\/')[4]
                                getAllUserId(weiboId, userId, thisSiteIndex)
                            }
                        }
                        else {
                            setTimeout(function () {getUserSite(allIds, thisIdNo, thisSiteIndex)}, 10);

                        }
                    }
                    else{
                        var fansUrl = "http://weibo.com/aj/v6/user/newcard?ajwvr=5&id=" + userId + "&type=2&callback=123";
                        //异步爬取数据，多线程
                        request({
                            "uri": fansUrl,
                            "encoding": "utf-8",
                            "timeout": 120000
                        }, function(err,response,body){
                            if(err||(response.statusCode!=200&&response.statusCode!=201)){
                                console.log("no html response"+err);
                                setTimeout(function(){getUserSite(allIds, thisIdNo, thisSiteIndex)}, 30000)
                            }
                            else{
                                //log(userId + "** "+oldIdNo)
                                getUserLst(body, userId, allIds, thisIdNo,thisSiteIndex);
                            }
                        });
                    }
                });
            }
        });
}

function getUserLst(htmlContent, userId, allIds, oldIdNo, oldSite){
    //log(htmlContent)
    var thisIdNo = oldIdNo
    var thisSiteIndex = oldSite
    var matched = htmlContent.match(/<div.*\/div>/gm);   //<div class

    if(matched) {

        var str = matched[0].replace(/(\\n|\\t|\\r)/g, " ").replace(/\\"/g, "\"").replace(/\\\//g, "\/");;
        var str2 = unescape(str.replace(/\u/g, "%u"));
        var $ = cheerio.load(str2);

            var userInfo = getUserInfo($, userId);//获取每个用户的信息
            var moreInfo = getMoreInfo($, userInfo);
            //log(moreInfo)

            if (moreInfo) {
                saveUser(moreInfo, allIds.length);
                redisclient.sadd("users", userId)  //記錄到redis
                thisIdNo ++

                if(thisIdNo == allIds.length){
                    thisSiteIndex++
                    if(thisSiteIndex == allSites.length){
                        log("all site finished")
                    }else {
                        log("finish one site")
                        userCnt = 0;
                        var userId = allSites[thisSiteIndex].split('\/')[3]
                        var weiboId = allSites[thisSiteIndex].split('\/')[4]
                        getAllUserId(weiboId, userId, thisSiteIndex)

                    }
                }else{
                    setTimeout(function(){getUserSite(allIds, thisIdNo, thisSiteIndex)}, 500)
                }
            }
            else{
                log("cannot match userInfo: retry")
                setTimeout(function(){test(userId, allIds, thisIdNo, thisSiteIndex, 0)}, 500)
            }

    }
    else{
        log("html content don't match: retry: uid:"+userId)
        setTimeout(function(){test(userId, allIds, thisIdNo, thisSiteIndex, 0)}, 3000)
    }
}

function test(userId, allIds, oldIdNo, oldSite, time){
    if(time == 0){
        var fansUrl = "http://weibo.com/" + "1749127163" + "/info";//雷军uid

        request({
            "uri": fansUrl,
            "encoding": "utf-8",
            "timeout": 120000
        }, function(err,response,body){
            if(err||(response.statusCode!=200&&response.statusCode!=201)){                        //网络无响应，一般是断网
                console.log("no html response in test()"+err);
                setTimeout(function(){getUserSite(allIds, oldIdNo, oldSite)}, 180000)//180s
            }
            else{
                var matched = body.match(/\"clearfix\s*\\\".*\/ul>/gm);   //
                var matched2 = body.match(/\"tb_counter\s*\\\".*\/table>/gm);   //
                if(matched && matched2){    //说明网络很可能正常,可以爬雷军账户，可能是不存在该用户
                    setTimeout(function(){test(userId, allIds, oldIdNo, oldSite, 1)}, 500)//4s
                    log("雷军账户可爬，再次测试用户："+userId)
                }
                else {                       //说明网络不正常 ，很可能被封号
                    setTimeout(function () {test(userId, allIds, oldIdNo, oldSite, 0) }, 300000);//300s
                    log("可能被封号 ！！")
                }
            }
        });
    }
    else{
            var fansUrl = "http://weibo.com/" + userId + "/info";
            var thisuserid = userId
            //异步爬取数据，多线程
            request({
                "uri": fansUrl,
                "encoding": "utf-8",
                "timeout": 120000
            }, function(err,response,body){
                if(err||(response.statusCode!=200&&response.statusCode!=201)){
                    console.log("no html response"+err);
                    setTimeout(function(){getUserSite(allIds, oldIdNo, oldSite)}, 30000)//no response 30s
                }
                else{
                    log("userid："+thisuserid)
                    var matched = body.match(/\"clearfix\s*\\\".*\/ul>/gm);
                    var matched2 = body.match(/\"tb_counter\s*\\\".*\/table>/gm);
                    if(matched && matched2) {    //这次能爬该用户
                        getUserLst(body, thisuserid, allIds, oldIdNo, oldSite);
                    }
                    else {  //确认无该用户
                        redisclient.sadd("nousers", thisuserid)
                        var thisIdNo = oldIdNo + 1
                        var thisSiteIndex = oldSite

                        if(thisIdNo == allIds.length){
                            thisSiteIndex++
                            if(thisSiteIndex == allSites.length){
                                log("all site finished")
                            }else {
                                log("finish one site")
                                userCnt = 0;
                                var userId = allSites[thisSiteIndex].split('\/')[3]
                                var weiboId = allSites[thisSiteIndex].split('\/')[4]
                                getAllUserId(weiboId, userId, thisSiteIndex)
                            }
                        }else{
                            setTimeout(function(){getUserSite(allIds, thisIdNo, thisSiteIndex)}, 500)
                        }
                    }
                }
            });
    }
}

function getUserInfo($, userID){
    var dict = {"id":userID}//记录id

    if($('div div div div a').attr('title') != null){
        //显示名称
        dict["name"] = $('div div div div a').attr('title')
    }

    if($('div ul li a').attr('title') != null) {
        //显示地址
        dict['place'] = $('div ul li a').attr('title')
    }

    if($('div div div div em').attr('title') != null) {
        //显示性别
        dict['sex'] = $('div div div div em').attr('title')
    }
    return dict
}

function getMoreInfo($, userInfo){
    var friend = $('div span a em').eq(0).text()
    if(friend.match("万")){
        friend = friend.split("万")[0]+"0000"
    }

    var follow = $('div span a em').eq(1).text()
    if(follow.match("万")){
        follow = follow.split("万")[0]+"0000"
    }

    var weibo = $('div span a em').eq(2).text()
    if(weibo.match("万")){
        weibo = weibo.split("万")[0]+"0000"
    }
    //log(weibo)//关注，会显示万

    userInfo["friend"] = friend;//关注
    userInfo["follow"] = follow;//粉丝
    userInfo["weibo"]  = weibo;//微博
    return userInfo
}

function tryParseInt(str){
    try{
        return parseInt(str);
    }
    catch(e){
        console.log("parseInt failed.")
        return 0;
    }
}

function log(msg){
    console.log(msg);
}

function start() {
    var userName = "sparklesese2@163.com";
    var password = "99663388we";

    var preLoginUrl = "http://login.sina.com.cn/sso/prelogin.php?entry=weibo&callback=sinaSSOController.preloginCallBack&su=&rsakt=mod&checkpin=1&client=ssologin.js(v1.4.11)&_=" + (new Date()).getTime();

    async.waterfall([
        function (callback) {
            request({
                "uri": preLoginUrl,
                "encoding": "utf-8"
            }, callback);
        },
        function (responseCode, body, callback) {
            var responseJson = getJsonObj(body);

            log(responseJson);
            log("Prelogin Success. ");

            var loginUrl = 'http://login.sina.com.cn/sso/login.php?client=ssologin.js(v1.4.18)';
            var loginPostData = {
                entry: "weibo",
                gateway: "1",
                from: "",
                savestate: "7",
                useticket: "1",
                vsnf: "1",
                su: "",
                service: "miniblog",
                servertime: "",
                nonce: "",
                pwencode: "rsa2",
                rsakv: "1330428213",
                sp: "",
                sr: "1366*768",
                encoding: "UTF-8",
                prelt: "282",
                url: "http://weibo.com/ajaxlogin.php?framelogin=1&callback=parent.sinaSSOController.feedBackUrlCallBack",
                returntype: "META"
            };

            loginPostData.su = new Buffer(userName).toString('base64');

            //给密码用RSA加密
            var rsaKey = new RsaEncrypt();
            rsaKey.setPublic(responseJson.pubkey, '10001');
            var pwd = rsaKey.encrypt([responseJson.servertime, responseJson.nonce].join("\t") + "\n" + password);

            log([responseJson.servertime, responseJson.nonce].join("\t") + "\n" + password);

            loginPostData.sp = pwd;

            loginPostData.servertime = responseJson.servertime;
            loginPostData.nonce = responseJson.nonce;
            loginPostData.rsakv = responseJson.rsakv;

            log("pk:" + responseJson.pubkey);
            log("su:" + loginPostData.su);
            log("pwd:" + loginPostData.sp);

            request.post({
                "uri": loginUrl,
                "encoding": null,  //GBK编码 需要额外收到处理,

                form: loginPostData

            }, callback);
        },
        function (responseCode, body, callback) {//登陆失败的回调函数
            body = iconv.decode(body,"GBK");

            log(body)

            var errReason = /reason=(.*?)\"/;
            var errorLogin = body.match(errReason);

            if (errorLogin) {
                callback("登录失败,原因:" + errorLogin[1]);
            }
            else {
                var urlReg = /location\.replace\(\'(.*?)\'\)./;
                var urlLoginAgain = body.match(urlReg);

                if (urlLoginAgain) {

                    request({
                        "uri": urlLoginAgain[1],
                        "encoding": "utf-8",
                        "timeout": 120000
                    }, callback);
                }
                else {
                    callback("match failed");
                }
            }
        },
        function (responseCode, body, callback) { //登陆成功的回调函数
            console.log("登录完成");
            var responseJson = getJsonObj(body);
            console.log(responseJson);

            var myfansUrl = "http://weibo.com/" + responseJson.userinfo.uniqueid +  "/myfans"

            request({
                "uri": myfansUrl,
                "encoding": "utf-8",
                "timeout": 120000
            }, callback);

            var fansUrl = "http://weibo.com/{userId}/fans";
        },
        function (responseCode, body, callback) {
            console.log("开始分析... ");

            var data=fs.readFileSync("sites_users_json.txt","utf-8");
            data.split('\r').forEach(function(item, index){  //读取全部web sites
                var thisSite = item.trim().split(';')[0]
                allSites.push(thisSite)
                log(thisSite+"    ---- "+allSites.length)
            })

            var userId = allSites[0].split('\/')[3]     //开始处理第一个web site
            var weiboId = allSites[0].split('\/')[4]
            getAllUserId(weiboId, userId, 0)

        }
    ], function (err) {
        console.log(err)
    });
}


//正式开始启动
start();