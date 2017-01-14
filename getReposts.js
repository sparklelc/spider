/**
 * Created by LC on 2015/9/30.
 */


/**
 * Created by lenovo on 2014/9/14.
 */

//test redis-db-7, mongo-db-weiboSina3, sites.txt

var iconv = require('iconv-lite'); //字符集转换
var utf8 = require('utf8')
var mongo = require('mongodb');
var monk = require('monk');
var redis = require('redis')
var async = require('async');
var cheerio = require('cheerio');
var Request = require('request');
var rf=require("fs");
var cookieColl = Request.jar();
var request = Request.defaults({jar: cookieColl});
var RsaEncrypt = require("./rsa").RSAKey;

var connection_string = '127.0.0.1:27017/weiboSina3';
var db = monk(connection_string);
var cachedReposts = {};
var redisclient = redis.createClient()
redisclient.select(7, function(){})

var repostCnt = 0;
var totalSitesNum = 0;
var thisSiteIndex = 0;
var allSites = new Array()

function saveRepost(weiboIdstr, repost){
    repostCnt += 1
    var userColl = db.get(weiboIdstr);
    userColl.insert(repost);
    //log("save:one report mongo"+repostCnt)
}

function saveWeibo(weibo){
    var coll = db.get("weibo");
    coll.insert(weibo);
    log("save:one weibo mongo"+weibo['weibo'])
}


function getJsonObj(body){
    var start = body.indexOf("{");
    var end = body.lastIndexOf("}");
    var jsonStr = body.substr(start,end -start + 1);
    var responseJson = JSON.parse(jsonStr);
    return responseJson;
}

function getWeiboInfo(url, weiboId, userId){
    var result = {"weibo":weiboId, "uid":userId}
    log("\nstart weibo:"+weiboId);
    //log(url)

    request({
        "uri": url,
        "encoding": "utf-8"
    }, function(err,response,body){
        if(err){
            console.log(err);
        }
        else{
            var contentmatched = body.match(/\"WB_text W_f14\s*\\\".*\/div>/gm)
            var datematched = body.match(/date=\\\".*\\\"/gm);
            var othersmatched = body.match(/\"WB_row_line WB_row_r4.*\/ul>/gm)

            if(contentmatched && datematched && othersmatched){
                var str1 = contentmatched[0].replace(/(\\n|\\t|\\r)/g, " ").replace(/\\/g, "");
                var ulStr1 = "<div class" + str1;
                var str2 = datematched[0].replace(/(\\n|\\t|\\r)/g, " ").replace(/\\/g, "");
                var str3 = othersmatched[0].replace(/(\\n|\\t|\\r)/g, " ").replace(/\\/g, "");
                var ulStr3 = "<ul class=" + str3;

                var $ = cheerio.load(ulStr1);
                result['content'] = $('div').first().text().trim();

                result['date'] = str2.split('"')[1]

                $ = cheerio.load(ulStr3);
                var repostNumStr = $('ul li').eq(1).text().trim()
                if(repostNumStr.length == 2){
                    result['repost'] = '0'
                }else{
                    result['repost'] = repostNumStr.split("转发")[1].trim()
                }
                var commentNumStr = $('ul li').eq(2).text().trim()
                if(commentNumStr.length == 2){
                    result['comment'] = '0'
                }else{
                    result['comment'] = commentNumStr.split("评论")[1].trim()
                }
                var zanNumStr = $('ul li').eq(3).text().trim()
                if(zanNumStr.length == 0){
                    result['zan'] = '0'
                }else{
                    result['zan'] = zanNumStr
                }

                //log(body)
                redisclient.sismember("weibo", weiboId, function(value,exist){
                    if(!exist) {//如果之前没爬过这个weiboid
                        saveWeibo(result)                       //保存该微博的基本信息
                        redisclient.sadd("weibo", weiboId)
                    }
                    else{
                        log("weibo:"+weiboId+"'s information have been load before")
                    }

                    var json_id = body.match(/mblog&act=.*\"/gm)[0]
                    json_id = json_id.split("=")[1].split('&')[0]
                    json_id = json_id.split("\\")[0]
                    //log(":::::"+json_id)

                    getAllRepostPages(weiboId, userId, json_id)
                });

            }else{
                log("cannot match the info of this weibo : 180s retry"+weiboId)
                setTimeout(function(){getWeiboInfo(url, weiboId, userId)}, 180000) //180s
            }

        }
    });
}

function getAllRepostPages(weiboId, userId, json_id){

    var json_maxid = ""

    //while(i<=largestPageNum){
    var fansUrl = ""
    fansUrl = "http://weibo.com/aj/v6/mblog/info/big?ajwvr=6&id=" + json_id + "&__rnd=" + (new Date()).getTime();

    //log(fansUrl)

        //异步爬取数据，多线程
        request({
            "uri": fansUrl,
            "encoding": "utf-8"
        }, function(err,response,body){
            if(err){
                console.log("give up this site: no html response:"+ fansUrl +" - " + err); //no html response
            }
            else{
                var thisweiboId = weiboId
                redisclient.sismember("weiboFinish", weiboId, function(value,exist) {

                    if(exist){
                        log('finish before:' + allSites[thisSiteIndex])

                        thisSiteIndex++;
                        if(thisSiteIndex < totalSitesNum){
                            var userId = allSites[thisSiteIndex].split('\/')[3]//'2609400635'//"1567041270"//"3774371267"
                            var weiboId = allSites[thisSiteIndex].split('\/')[4]//'CBx5GobBs'//"zbqyICBVZ"//"CCOLND4ci"

                            var weiboUrl = "http://weibo.com/" + userId + "/" + weiboId + "?type=repost"
                            getWeiboInfo(weiboUrl, weiboId, userId)
                        }else{
                            log('all finish before')
                        }
                    }else {

                        redisclient.hexists("weiboPage", thisweiboId, function (value, exist) {
                            //log("******"+json_id+": "+json_maxid+": ")
                            if (!exist) {//如果之前没记录这个weibo的页数
                                getOneReportPage(body, 1, json_id, json_maxid, thisweiboId);      //从第一页开始
                            }
                            else {
                                redisclient.hget("weiboPage", thisweiboId, function (err, reply) {
                                    //log("******"+json_id+": "+json_maxid+": "+reply)
                                    if (err) {
                                        log("redis error: h-key exist but cannot get")      //redis错误？
                                    }
                                    else {
                                        //log(tryParseInt(reply) + 1)
                                        getOneReportPage(body, tryParseInt(reply) + 1, json_id, json_maxid, thisweiboId); //从上次的下一页开始
                                    }
                                });
                            }
                        });
                    }
                });

            }
        });

}

function getOneReportPage(htmlContent, pageNum, id, maxid, weiboId) {

    var matched
    if (pageNum == 1) {
        matched = htmlContent.match(/class=\\\"between_line S_bg1\\\">.*<!--/gm)
    }
    if (!matched) {
        matched = htmlContent.match(/<div.*<!--/gm)
    }

    if (matched) {
        //log(str)
        var str = matched[0].replace(/(\\n|\\t|\\r)/g, " ").replace(/\\"/g, "\"").replace(/\\\//g, "\/");    //.replace(/\\/g, "")

        //log(str)
        var ulStr
        if (pageNum == 1) {
            ulStr = "<div " + str + "-->"
        }
        else {
            ulStr = str + "-->"
        }

        var $ = cheerio.load(ulStr)
        $('div[action-type=feed_list_item]').map(function (index, item) {
            var result = {}
            var $$ = cheerio.load(item)

            var date = $$.html().toString().match(/date=\".*\"/gm)[0].split("\"")[1]
            result['date'] = date

            var uid = $$('div a').attr('usercard').split('=')[1]
            result['uid'] = uid

            var content = unescape($$('div span').first().text().replace(/\u/g, "%u"))
            result['content'] = content

            var report = unescape($$('div ul li span a').eq(1).text().replace(/\u/g, "%u"));
            //或则str = eval("'" + str + "'"); // "我是unicode编码"
            var reportNum = '0'
            if (report.length != 2) {
                reportNum = report.split(' ')[1]
            }
            result['reportNum'] = reportNum

            var zan = unescape($$('div ul li span a').eq(2).text().replace(/\u/g, "%u"));
            var zanNum = '0'
            if (zan.length != 0) {
                zanNum = zan.trim()
            }
            result['zanNum'] = zanNum

            saveRepost(weiboId, result)

        });
        redisclient.hset("weiboPage", weiboId, pageNum)    //更新到redis里面爬到的page页数***************


    }
    else{
        log("html-no-match"+htmlContent)
    }

    var maxPageNummatch = htmlContent.match(/\"totalpage\":.*,/gm)
    var maxPageNum = 0
    if(maxPageNummatch) {
        maxPageNum = parseInt(maxPageNummatch[0].split(':')[1].split(',')[0])
    }
    else{
        log("no maxPage"+htmlContent)
    }

    log("save:one report mongo:now-report-num"+repostCnt+" now_page_num: "+pageNum+"maxpage:"+maxPageNum)
    //log("maxpage:"+maxPageNum)


    var newmaxidmatch = htmlContent.match(/max_id=.*&page=/gm)
    var newmaxid = "";
    if(newmaxidmatch) {
        newmaxid= newmaxidmatch[0].split('=')[1].split('&')[0]
    }
    else{
        log("no maxid"+htmlContent)
    }

    if (pageNum < maxPageNum) {
        var newPageNum = pageNum + 1
        var fansUrl = "http://weibo.com/aj/v6/mblog/info/big?ajwvr=6&id=" + id + "&max_id=" + newmaxid + "&page=" + newPageNum + "&__rnd=" + (new Date()).getTime();
        setTimeout(function () {
            request({
                "uri": fansUrl,
                "encoding": "utf-8"
            }, function (err, response, body) {
                if (err) {
                    console.log("" + err);
                    retry(fansUrl, newPageNum, id, newmaxid, weiboId, 30000)
                    log("no html response:retry")
                }
                else {
                    //log(fansUrl)
                    getOneReportPage(body, newPageNum, id, newmaxid, weiboId);
                }
            });
        }, 100);
    }
    else if(pageNum >= maxPageNum && (maxPageNum!=0 && maxPageNum!=1)){
        log("now page num:"+pageNum+" & maxPageNum:"+maxPageNum)
        log('finish:' + allSites[thisSiteIndex])
        redisclient.hdel("weiboPage", weiboId)     //删除到redis里面爬到的page页数***************
        redisclient.sadd("weiboFinish", weiboId)
        repostCnt = 0;
        thisSiteIndex++;
        if(thisSiteIndex < totalSitesNum){
            var userId = allSites[thisSiteIndex].split('\/')[3]//'2609400635'//"1567041270"//"3774371267"
            var weiboId = allSites[thisSiteIndex].split('\/')[4]//'CBx5GobBs'//"zbqyICBVZ"//"CCOLND4ci"

            var weiboUrl = "http://weibo.com/" + userId + "/" + weiboId + "?type=repost"
            getWeiboInfo(weiboUrl, weiboId, userId)
        }else{
            log('all finish')
            redisclient.hdel("weiboPage", weiboId)
        }
    }
    else if(maxPageNum == 1){
        log('maxpagenum==1'+maxPageNum)
        var fansUrl = "http://weibo.com/aj/v6/mblog/info/big?ajwvr=6&id=" + id + "&max_id=" + maxid + "&page=" + pageNum + "&__rnd=" + (new Date()).getTime();
        retry(fansUrl, pageNum, id, maxid, weiboId, 100)
    }
    else{
        log('maxpagenum==0? 可能被封！！'+maxPageNum)
        var fansUrl = "http://weibo.com/aj/v6/mblog/info/big?ajwvr=6&id=" + id + "&max_id=" + maxid + "&page=" + pageNum + "&__rnd=" + (new Date()).getTime();
        retry(fansUrl, pageNum, id, maxid, weiboId, 180000)
    }
}

function retry(url, newPageNum, id, newmaxid, weiboId, time){
        setTimeout(function() {
            request({
                "uri": url,
                "encoding": "utf-8"
            }, function (err, response, body) {
                if (err) {
                    console.log("" + err);
                    retry(url, newPageNum, id, newmaxid, weiboId,30000)
                    log('retry no html response')
                }
                else {
                    getOneReportPage(body, newPageNum, id, newmaxid, weiboId);
                }
            });
        }, time);
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
    var userName = "526542906@qq.com";
    var password = "99663388we";

    var preLoginUrl = "http://login.sina.com.cn/sso/prelogin.php?entry=weibo&callback=sinaSSOController.preloginCallBack&su=&rsakt=mod&checkpin=1&client=ssologin.js(v1.4.11)&_=" + (new Date()).getTime();

    async.waterfall([
        function (callback) {
            request({
                "uri": preLoginUrl,
                "encoding": "utf-8"
            }, callback);
        },
        function (responseCode, body, callback) { //函数一
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
        function (responseCode, body, callback) {//登陆成功的回调函数2
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
        function (responseCode, body, callback) { //登陆成功的回调函数3
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
        function (responseCode, body, callback) {       //函数4
            console.log("\n\n\n\n\n\n开始分析... ");

            var data=rf.readFileSync("sites.txt","utf-8");
            data.split('\r').forEach(function(item, index){
                var thisSite = item.trim().split(';')[0]
                totalSitesNum ++;
                allSites.push(thisSite)
                log(thisSite+" "+totalSitesNum)// + allSites)
            })

            var userId = allSites[thisSiteIndex].split('\/')[3]//'2609400635'//"1567041270"//"3774371267"
            var weiboId = allSites[thisSiteIndex].split('\/')[4]//'CBx5GobBs'//"zbqyICBVZ"//"CCOLND4ci"

            var weiboUrl = "http://weibo.com/" + userId + "/" + weiboId + "?type=repost"
            getWeiboInfo(weiboUrl, weiboId, userId)//start from the first weisite


        }
    ], function (err) {
        console.log(err)
    });
}

//正式开始启动
start();