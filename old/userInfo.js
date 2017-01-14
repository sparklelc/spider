/**
 * Created by LC on 2015/9/29.
 */


/**
 * Created by lenovo on 2014/9/14.
 */

//这个js用的是redis 5号数据库， 而且读的json文件名为：sites_users.txt，已经被弃用

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
redisclient.select(5, function(){})

var userCnt = 0;
var allSites = new Array()

function saveUser(user){
    var userColl = db.get("users");
    userColl.insert(user);
    userCnt++;
    log("save:mongo "+userCnt+"   id: "+user.id)
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
            allIds.push(item.uid)
        })
        log("total of this weisite:"+allIds.length+"   "+userId)
        setTimeout(function(){getUserSite(allIds, thisIdNo, thisSite)}, 6000)
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
                console.log("duplicate users:"+userId+"   total:"+allIds.length);
                thisIdNo = oldIdNo + 1
                if(thisIdNo == allIds.length){
                    thisSiteIndex = oldIdNo + 1
                    if(thisSiteIndex == allSites.length){
                        log("all site finished")
                    }else {
                        log("finish one site")
                        var userId = allSites[thisSiteIndex].split('\/')[3]
                        var weiboId = allSites[thisSiteIndex].split('\/')[4]
                        getAllUserId(weiboId, userId, thisSiteIndex)
                    }
                }
                else {
                    setTimeout(function () {getUserSite(allIds, thisIdNo, thisSiteIndex)}, 100);

                }
            }
            else{ //如果之前没爬过这个uid
                    var fansUrl = "http://weibo.com/" + userId + "/info";
                    //异步爬取数据，多线程
                    request({
                        "uri": fansUrl,
                        "encoding": "utf-8"
                    }, function(err,response,body){
                        if(err){
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

function getUserLst(htmlContent, userId, allIds, oldIdNo, oldSite){
    //log(htmlContent)
    var thisIdNo = oldIdNo
    var thisSiteIndex = oldSite
    var matched = htmlContent.match(/\"clearfix\s*\\\".*\/ul>/gm);   //
    var matched2 = htmlContent.match(/\"tb_counter\s*\\\".*\/table>/gm);   //

    if(matched && matched2) {

            var str = matched[0].replace(/(\\n|\\t|\\r)/g, " ").replace(/\\/g, "");
            var ulStr = "<ul class=" + str;

            var str2 = matched2[0].replace(/(\\n|\\t|\\r)/g, " ").replace(/\\/g, "");
            var ulStr2 = "<table class=" + str2;

            var $ = cheerio.load(ulStr);
            var userInfo = getUserInfo($, userId);//获取每个用户的信息

            $ = cheerio.load(ulStr2);
            var moreInfo = getMoreInfo($, userInfo)

            if (moreInfo) {
                saveUser(moreInfo);
                redisclient.sadd("users", userId)  //記錄到redis
                thisIdNo ++

                if(thisIdNo == allIds.length){
                    thisSiteIndex++
                    if(thisSiteIndex == allSites.length){
                        log("all site finished")
                    }else {
                        log("finish one site")
                        var userId = allSites[thisSiteIndex].split('\/')[3]
                        var weiboId = allSites[thisSiteIndex].split('\/')[4]
                        getAllUserId(weiboId, userId, thisSiteIndex)

                    }
                }else{
                    setTimeout(function(){getUserSite(allIds, thisIdNo, thisSiteIndex)}, 6000)
                }
            }
            else{
                log("cannot match userInfo: retry")
                setTimeout(function(){test(userId, allIds, thisIdNo, thisSiteIndex, 0)}, 6000)
            }
    }
    else{
        log("html content don't match: retry: uid:"+userId)
        setTimeout(function(){test(userId, allIds, thisIdNo, thisSiteIndex, 0)}, 60000)
    }
}

function test(userId, allIds, oldIdNo, oldSite, time){
    if(time == 0){
        var fansUrl = "http://weibo.com/" + "1749127163" + "/info";//雷军uid
        request({
            "uri": fansUrl,
            "encoding": "utf-8"
        }, function(err,response,body){
            if(err){                        //网络无响应，一般是断网
                console.log("no html response in test()"+err);
                setTimeout(function(){getUserSite(allIds, oldIdNo, oldSite)}, 180000)//180s
            }
            else{
                var matched = body.match(/\"clearfix\s*\\\".*\/ul>/gm);   //
                var matched2 = body.match(/\"tb_counter\s*\\\".*\/table>/gm);   //
                if(matched && matched2){    //说明网络很可能正常,可以爬雷军账户，可能是不存在该用户
                    setTimeout(function(){test(userId, allIds, oldIdNo, oldSite, 1)}, 6000)//4s
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
                "encoding": "utf-8"
            }, function(err,response,body){
                if(err){
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
                        var thisIdNo = oldIdNo + 1
                        var thisSiteIndex = oldSite

                        if(thisIdNo == allIds.length){
                            thisSiteIndex++
                            if(thisSiteIndex == allSites.length){
                                log("all site finished")
                            }else {
                                log("finish one site")
                                var userId = allSites[thisSiteIndex].split('\/')[3]
                                var weiboId = allSites[thisSiteIndex].split('\/')[4]
                                getAllUserId(weiboId, userId, thisSiteIndex)
                            }
                        }else{
                            setTimeout(function(){getUserSite(allIds, thisIdNo, thisSiteIndex)}, 6000)
                        }
                    }
                }
            });
    }
}

function getUserInfo($, userID){
    var dict = {"id":userID}

    $('li').map(function (index, item) {
        var name = $(this).children().first().text().trim();
        var value = $(this).children().last().text().trim();
        //log(name+value);
        if(name == "昵称："){
            dict["name"]=value
            //log("name");
        }
        else if(name == "所在地：") {
            dict["place"] = value
            //log("place");
        }
        else if(name == "性别：") {
            dict["sex"] = value
            //log("sex");
        }
        else if(name == "注册时间：") {
            dict["time"] = value
            //log("time");
        }

    });
    return dict
}

function getMoreInfo($, userInfo){
    userInfo["friend"] = $('table tr').children().eq(0).text().trim().split("关注")[0];//关注
    userInfo["follow"] = $('table tr').children().eq(1).text().trim().split("粉丝")[0];//粉丝
    userInfo["weibo"]  = $('table tr').children().eq(2).text().trim().split("微博")[0];//微博
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
    var userName = "sparklesese@163.com";
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
                        "encoding": "utf-8"
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
                "encoding": "utf-8"
            }, callback);

            var fansUrl = "http://weibo.com/{userId}/fans";
        },
        function (responseCode, body, callback) {
            console.log("开始分析... ");

            var data=fs.readFileSync("sites_users.txt","utf-8");
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